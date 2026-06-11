#!/usr/bin/env node

import { execFileSync, execSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { homedir } from "node:os";
import { basename, dirname, extname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { analyzeSession } from "../src/lib/analyzer";
import { isHumanVisibleMessage, parseSession } from "../src/lib/parser";
import type { Provider } from "../src/lib/providers";

interface SessionFile {
  session_id: string;
  project: string;
  path: string;
  size_bytes: number;
  modified: number;
}

type OutputFormat = "markdown" | "json" | "jsonl" | "langchain-jsonl";

type SortMode = "latest" | "score";

interface CliOptions {
  command: string;
  path?: string;
  provider?: Provider;
  project?: string;
  limit: number;
  format: OutputFormat;
  quick: boolean;
  sort: SortMode;
  verbose: boolean;
}

interface SessionListRow {
  session: SessionFile;
  provider: Provider;
  analysis?: ReturnType<typeof analyzeOne>;
  error?: string;
}

const IGNORED_FILES = new Set([
  "logs.json",
  "projects.json",
  "settings.json",
  "state.json",
  "hud-state.json",
  "oauth_creds.json",
]);

main();

function main() {
  try {
    const options = parseArgs(process.argv.slice(2));

    if (options.command === "help") {
      printHelp();
      return;
    }

    const sessions = listSessions()
      .filter(session => !options.provider || inferProvider(session) === options.provider)
      .filter(session => !options.project || session.project.includes(options.project))
      .sort((a, b) => b.modified - a.modified);

    if (options.command === "list") {
      printSessionList(
        sessions.slice(0, options.limit),
        options.format,
        options.quick,
        options.sort,
        options.verbose,
      );
      return;
    }

    if (options.command === "analyze") {
      const session = options.path
        ? sessionFromPath(options.path)
        : sessions[0];
      if (!session) fail("No session found. Pass a path or run a supported AI tool first.");

      const result = analyzeOne(session);
      printAnalysis(result, options.format);
      return;
    }

    if (options.command === "export") {
      const selected = options.path ? [sessionFromPath(options.path)] : sessions.slice(0, options.limit);
      const results = selected.filter(Boolean).map(session => analyzeOne(session));
      printExport(results, options.format);
      return;
    }

    fail(`Unknown command: ${options.command}`);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}

function parseArgs(rawArgs: string[]): CliOptions {
  let args = [...rawArgs];
  while (args[0] === "--") {
    args.shift();
  }

  const options: CliOptions = {
    command: args[0] ?? "help",
    limit: 10,
    format: "markdown",
    quick: false,
    sort: "latest",
    verbose: false,
  };

  let i = 1;
  if (options.command === "analyze" && args[i] && !args[i].startsWith("--")) {
    options.path = args[i++];
  }
  if (options.command === "export" && args[i] && !args[i].startsWith("--")) {
    options.path = args[i++];
  }

  for (; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];

    if (arg === "--limit" && next) {
      options.limit = Number(next);
      i++;
    } else if (arg === "--format" && next) {
      options.format = next as OutputFormat;
      i++;
    } else if (arg === "--provider" && next) {
      options.provider = next as Provider;
      i++;
    } else if (arg === "--project" && next) {
      options.project = next;
      i++;
    } else if (arg === "--langchain") {
      options.format = "langchain-jsonl";
    } else if (arg === "--quick") {
      options.quick = true;
    } else if (arg === "--verbose" || arg === "-v") {
      options.verbose = true;
    } else if (arg === "--sort" && next) {
      if (next !== "latest" && next !== "score") {
        fail('--sort must be "latest" or "score"');
      }
      options.sort = next;
      i++;
    } else {
      fail(`Unknown option: ${arg}`);
    }
  }

  if (!Number.isFinite(options.limit) || options.limit < 1) {
    fail("--limit must be a positive number");
  }

  return options;
}

function listSessions(): SessionFile[] {
  const home = homedir();
  const sessions: SessionFile[] = [];

  scanJsonSessions(join(home, ".claude", "projects"), "claude", sessions, true);
  scanGeminiTmp(join(home, ".gemini", "tmp"), sessions);
  scanJsonSessions(join(home, ".omc", "state", "sessions"), "omc-global", sessions, true);
  scanJsonSessions(join(home, ".codex", "sessions"), "codex", sessions, true);
  scanCursorStores(join(home, ".cursor", "chats"), sessions);

  const seen = new Set<string>();
  return sessions.filter(session => {
    if (seen.has(session.path)) return false;
    seen.add(session.path);
    return true;
  });
}

function scanGeminiTmp(dir: string, sessions: SessionFile[]) {
  if (!existsSync(dir)) return;
  for (const name of safeReadDir(dir)) {
    const path = join(dir, name);
    if (isDirectory(path)) scanJsonSessions(path, name, sessions, true);
  }
}

function scanJsonSessions(dir: string, project: string, sessions: SessionFile[], recursive: boolean) {
  if (!existsSync(dir)) return;
  for (const name of safeReadDir(dir)) {
    const path = join(dir, name);
    if (isDirectory(path) && recursive) {
      scanJsonSessions(path, project, sessions, true);
      continue;
    }

    const ext = extname(path);
    if (!isFile(path) || (ext !== ".jsonl" && ext !== ".json") || IGNORED_FILES.has(name)) continue;
    if (project === "codex" && !codexHasVisibleUserTurn(path)) continue;

    const session = getSessionFile(path, project);
    if (session) sessions.push(session);
  }
}

function scanCursorStores(dir: string, sessions: SessionFile[]) {
  if (!existsSync(dir)) return;
  for (const name of safeReadDir(dir)) {
    const path = join(dir, name);
    if (isDirectory(path)) {
      scanCursorStores(path, sessions);
    } else if (isFile(path) && name === "store.db") {
      const session = getCursorSessionFile(path);
      if (session) sessions.push(session);
    }
  }
}

function getSessionFile(path: string, projectName: string): SessionFile | null {
  const stats = statSync(path);
  if (stats.size < 50) return null;

  const sessionId = basename(path, extname(path));
  const project = projectName === "codex"
    ? inferCodexProject(path) ?? projectName
    : sessionId.includes("dogfood-bad")
    ? "dogfood-bad"
    : sessionId.includes("dogfood-good")
    ? "dogfood-good"
    : sessionId.includes("dogfood")
    ? "tokenscope-dogfood"
    : projectName;

  return {
    session_id: sessionId,
    project,
    path,
    size_bytes: stats.size,
    modified: Math.floor(stats.mtimeMs / 1000),
  };
}

function getCursorSessionFile(path: string): SessionFile | null {
  const stats = statSync(path);
  if (stats.size < 50) return null;

  const agentId = basename(dirname(path));
  const workspaceId = basename(dirname(dirname(path)));
  return {
    session_id: agentId,
    project: cursorProjectName(workspaceId),
    path,
    size_bytes: stats.size,
    modified: Math.floor(stats.mtimeMs / 1000),
  };
}

function sessionFromPath(path: string): SessionFile {
  if (!existsSync(path)) fail(`Session path not found: ${path}`);
  if (path.includes("/.cursor/chats/") && basename(path) === "store.db") {
    const session = getCursorSessionFile(path);
    if (!session) fail(`Cursor session is empty: ${path}`);
    return session;
  }

  const project = path.includes("/.codex/") ? "codex" : path.includes("/.gemini/") ? "gemini" : "claude";
  const session = getSessionFile(path, project);
  if (!session) fail(`Session is empty: ${path}`);
  return session;
}

function analyzeOne(session: SessionFile) {
  const raw = readSessionContent(session);
  const parsed = parseSession(raw, session.session_id, session.project, session.path);
  const result = analyzeSession(parsed, readConfigForProvider(parsed.provider));
  return { session, parsed, result };
}

function readSessionContent(session: SessionFile): string {
  if (session.path.includes("/.cursor/chats/") && basename(session.path) === "store.db") {
    return readCursorStoreAsJsonl(session.path);
  }
  return readFileSync(session.path, "utf8");
}

function readCursorStoreAsJsonl(path: string): string {
  const lines: string[] = [];
  const meta = readCursorMeta(path);
  if (meta) lines.push(JSON.stringify({ type: "cursor_meta", payload: meta }));

  for (const row of iterateCursorBlobRows(path)) {
    const [id, hex] = splitFirst(row, "|");
    if (!id || !hex) continue;

    try {
      const text = Buffer.from(hex.trim(), "hex").toString("utf8");
      const payload = JSON.parse(text);
      if (payload && payload.role) {
        lines.push(JSON.stringify({ type: "cursor_message", id, payload }));
      }
    } catch {
      // Cursor stores some non-JSON/binary blobs; skip them.
    }
  }

  if (lines.length <= 1) fail(`Cursor store did not contain readable message blobs: ${path}`);
  return lines.join("\n");
}

function* iterateCursorBlobRows(path: string, batchSize = 10): Generator<string> {
  let offset = 0;
  while (true) {
    const rows = sqlite(
      path,
      `select id, hex(data) from blobs limit ${batchSize} offset ${offset}`,
    );
    const batch = rows.split("\n").map(line => line.trim()).filter(Boolean);
    if (batch.length === 0) break;

    for (const row of batch) yield row;

    if (batch.length < batchSize) break;
    offset += batchSize;
  }
}

function readCursorMeta(path: string): unknown | null {
  const raw = sqlite(path, "select value from meta where key = '0' limit 1").trim();
  if (!raw) return null;

  try {
    const decoded = /^[a-fA-F0-9]+$/.test(raw)
      ? Buffer.from(raw, "hex").toString("utf8")
      : raw;
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

function readConfigForProvider(provider: Provider): string {
  const home = homedir();
  const candidates =
    provider === "claude" ? [join(home, ".claude", "CLAUDE.md")] :
    provider === "gemini" ? [join(home, ".gemini", "GEMINI.md"), join(home, ".config", "gemini-cli", "GEMINI.md")] :
    provider === "codex" ? [join(home, ".codex", "AGENTS.md")] :
    [];

  for (const path of candidates) {
    if (existsSync(path)) return readFileSync(path, "utf8");
  }
  return "";
}

function printSessionList(
  sessions: SessionFile[],
  format: OutputFormat,
  quick = false,
  sort: SortMode = "latest",
  verbose = false,
) {
  const rows: SessionListRow[] = sessions.map(session => {
    const provider = inferProvider(session);
    if (quick) return { session, provider };

    try {
      return { session, provider, analysis: analyzeOne(session) };
    } catch (error) {
      return {
        session,
        provider,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  if (!quick && sort === "score") {
    rows.sort((a, b) => {
      const sa = a.analysis?.result.healthScore;
      const sb = b.analysis?.result.healthScore;
      if (sa === undefined && sb === undefined) return b.session.modified - a.session.modified;
      if (sa === undefined) return 1;
      if (sb === undefined) return -1;
      if (sa !== sb) return sa - sb;
      return b.session.modified - a.session.modified;
    });
  }

  if (format === "json" || format === "jsonl" || format === "langchain-jsonl") {
    const payload = rows.map(row => toSessionListJson(row));
    printStructured(payload, format === "json" ? "json" : "jsonl");
    return;
  }

  if (quick) {
    for (const row of rows) {
      const date = new Date(row.session.modified * 1000).toISOString();
      console.log(`${date}  ${row.provider.padEnd(7)}  ${row.session.project.padEnd(24)}  ${row.session.path}`);
    }
    return;
  }

  printSessionDashboard(rows, verbose);
}

function toSessionListJson(row: SessionListRow) {
  const base = {
    ...row.session,
    provider: row.provider,
    projectLabel: decodeProjectName(row.session.project),
  };

  if (row.error) {
    return { ...base, analysisError: row.error };
  }
  if (!row.analysis) return base;

  return {
    ...base,
    ...toAnalysisJson(row.analysis),
  };
}

function printSessionDashboard(rows: SessionListRow[], verbose = false) {
  if (rows.length === 0) {
    console.log("세션을 찾지 못했습니다.");
    return;
  }

  const provider = rows.every(row => row.provider === rows[0]?.provider) ? rows[0]?.provider : undefined;
  printCliBanner(provider ? `${providerLabel(provider)} · 최근 ${rows.length}개 세션` : `최근 ${rows.length}개 세션`);
  printSummaryPanel(rows);
  rows.forEach((row, index) => printSessionCard(row, index + 1, verbose));
  printCliFooter(rows);
  console.log("");
}

function printCliBanner(subtitle: string) {
  console.log("");
  printBox([
    `${color("bold", "TokenScope")}  ${color("dim", "로컬 AI 세션 진단")}`,
    color("cyan", subtitle),
  ], "rounded");
}

function printSummaryPanel(rows: SessionListRow[]) {
  const analyzed = rows.filter(row => row.analysis?.result);
  if (analyzed.length === 0) {
    printBox(["분석 가능한 세션이 없습니다."], "rounded");
    return;
  }

  const scores = analyzed.map(row => row.analysis!.result.healthScore);
  const avgScore = Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length);
  const wastedSum = analyzed.reduce((sum, row) => sum + row.analysis!.result.totalWastedTokens, 0);
  const good = scores.filter(score => score >= 70).length;
  const warn = scores.filter(score => score >= 40 && score < 70).length;
  const bad = scores.filter(score => score < 40).length;
  const verdict = verdictFromScore(avgScore);

  printBox([
    `${color("bold", "오늘의 스냅샷")}`,
    `평균 ${formatScore(avgScore)}  ${verdict.badge}  ${color("green", `양호 ${good}`)}  ${color("yellow", `주의 ${warn}`)}  ${color("red", `위험 ${bad}`)}  ${color("dim", "·")}  낭비 ${formatTokenCount(wastedSum)}`,
    `${scoreBar(avgScore)}  ${color("dim", verdict.hint)}`,
  ], "rounded");
}

function printSessionCard(row: SessionListRow, index: number, verbose: boolean) {
  const projectName = row.analysis?.result.session.project ?? row.session.project;
  const project = decodeProjectName(projectName);
  const provider = providerBadge(row.provider);
  const analysis = row.analysis?.result;

  if (!analysis) {
    printBox([
      `${color("bold", `#${index}`)}  ${provider}  ${project}`,
      row.error ? color("red", `분석 실패: ${truncate(row.error, 64)}`) : color("dim", "분석 결과 없음"),
      verbose ? color("dim", row.session.path) : "",
    ].filter(Boolean), "card");
    return;
  }

  const verdict = verdictFromScore(analysis.healthScore);
  const totalTokens = getTotalTokens(analysis.session);
  const meta = [
    formatSessionDate(row.session.modified),
    relativeTime(row.session.modified),
    analysis.session.model ? truncate(analysis.session.model, 18) : null,
    `${formatTokenCount(totalTokens)} 토큰`,
    `낭비 ${formatTokenCount(analysis.totalWastedTokens)}`,
    analysis.estimatedCostFormatted ? analysis.estimatedCostFormatted : null,
  ].filter(Boolean).join(color("dim", " · "));

  const lines = [
    `${color("bold", `#${index}`)}  ${provider}  ${color("bold", truncate(project, 28))}  ${verdict.badge}  ${formatScore(analysis.healthScore)}`,
    meta,
    `${scoreBar(analysis.healthScore)}  ${color("dim", `${analysis.healthScore}/100`)}`,
    formatPatternsLine(analysis.patterns),
    analysis.sessionSummary ? `${color("dim", "요약")} ${truncate(analysis.sessionSummary, 76)}` : "",
    verbose ? color("dim", row.session.path) : "",
  ].filter(Boolean);

  printBox(lines, "card");
}

function printCliFooter(rows: SessionListRow[]) {
  const tip = buildSmartTip(rows);
  printBox([
    `${color("bold", "다음 액션")}`,
    tip,
    `${color("dim", "상세")} yarn cli analyze --format json    ${color("dim", "점수순")} --sort score    ${color("dim", "경로만")} --quick`,
  ], "rounded");
}

function printAnalysis(item: ReturnType<typeof analyzeOne>, format: OutputFormat) {
  if (format === "json" || format === "jsonl") {
    printStructured(toAnalysisJson(item), format);
    return;
  }
  if (format === "langchain-jsonl") {
    console.log(JSON.stringify(toLangChainDocument(item)));
    return;
  }

  const { result } = item;
  const verdict = verdictFromScore(result.healthScore);
  printCliBanner(`${providerLabel(result.session.provider)} · ${decodeProjectName(result.session.project)}`);
  printBox([
    `${verdict.badge}  ${formatScore(result.healthScore)}  ${scoreBar(result.healthScore)}`,
    [
      `모델 ${result.session.model || "—"}`,
      `비용 ${result.estimatedCostFormatted}`,
      `전체 ${formatTokenCount(getTotalTokens(result.session))}`,
      `낭비 ${formatTokenCount(result.totalWastedTokens)}`,
    ].join(color("dim", " · ")),
    `${color("dim", "기간")} ${formatDuration(result.session.startTime, result.session.endTime)}`,
  ], "rounded");

  printBox([
    `${color("bold", "세션 요약")}`,
    result.sessionSummary,
  ], "card");

  if (result.patterns.length === 0) {
    printBox([color("green", "낭비 패턴 없음 · 효율적으로 사용 중입니다.")], "card");
  } else {
    const patternLines = [...result.patterns]
      .sort((a, b) => b.estimatedWastedTokens - a.estimatedWastedTokens)
      .map(pattern => `${formatPatternLabel(pattern)}  ${color("dim", truncate(pattern.description, 58))}`);
    printBox([`${color("bold", "감지된 낭비 패턴")}`, ...patternLines], "card");
  }

  printBox([
    `${color("bold", "세부 점수")}`,
    ...formatBreakdownLines(result.scoreBreakdown),
  ], "card");

  printBox([color("dim", result.session.filePath)], "rounded");
  console.log("");
}

function printExport(items: ReturnType<typeof analyzeOne>[], format: OutputFormat) {
  if (format === "langchain-jsonl") {
    for (const item of items) console.log(JSON.stringify(toLangChainDocument(item)));
    return;
  }

  const rows = items.map(toAnalysisJson);
  printStructured(rows, format === "jsonl" ? "jsonl" : "json");
}

function toAnalysisJson(item: ReturnType<typeof analyzeOne>) {
  const { result } = item;
  return {
    source: result.session.filePath,
    provider: result.session.provider,
    project: result.session.project,
    sessionId: result.session.sessionId,
    model: result.session.model,
    startTime: result.session.startTime,
    endTime: result.session.endTime,
    healthScore: result.healthScore,
    totalInputTokens: result.session.totalInputTokens,
    totalOutputTokens: result.session.totalOutputTokens,
    totalCacheReadTokens: result.session.totalCacheReadTokens,
    totalWastedTokens: result.totalWastedTokens,
    estimatedCost: result.estimatedCost,
    estimatedCostFormatted: result.estimatedCostFormatted,
    summary: result.sessionSummary,
    patterns: result.patterns.map(pattern => ({
      type: pattern.type,
      severity: pattern.severity,
      title: pattern.title,
      description: pattern.description,
      estimatedWastedTokens: pattern.estimatedWastedTokens,
    })),
  };
}

function toLangChainDocument(item: ReturnType<typeof analyzeOne>) {
  const { result } = item;
  const visibleMessages = result.session.messages
    .filter(isHumanVisibleMessage)
    .map(message => `${message.role.toUpperCase()}: ${message.contentText}`)
    .join("\n\n");
  const analysis = toAnalysisJson(item);

  return {
    pageContent: [
      `TokenScope summary: ${result.sessionSummary}`,
      `Detected patterns: ${analysis.patterns.map(pattern => pattern.type).join(", ") || "none"}`,
      visibleMessages,
    ].filter(Boolean).join("\n\n"),
    metadata: {
      ...analysis,
      loader: "tokenscope-cli",
      documentType: "ai-session-analysis",
    },
  };
}

function printStructured(value: unknown, format: "json" | "jsonl") {
  if (format === "json") {
    console.log(JSON.stringify(value, null, 2));
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) console.log(JSON.stringify(item));
  } else {
    console.log(JSON.stringify(value));
  }
}

function inferProvider(session: SessionFile): Provider {
  if (session.path.includes("/.cursor/chats/")) return "cursor";
  if (session.path.includes("/.codex/") || session.project === "codex") return "codex";
  if (session.path.includes("/.gemini/") || session.path.includes("/.omc/")) return "gemini";
  return "claude";
}

function cursorProjectName(workspaceId: string): string {
  const workspaceJson = join(homedir(), ".cursor", "chats", workspaceId, "workspace.json");
  if (!existsSync(workspaceJson)) return "cursor";

  try {
    const value = JSON.parse(readFileSync(workspaceJson, "utf8"));
    const folder = value.folder ?? value.workspace?.folder ?? value.uri;
    if (!folder) return "cursor";
    const clean = String(folder).replace(/^file:\/\//, "");
    return basename(clean) || "cursor";
  } catch {
    return "cursor";
  }
}

function inferCodexProject(path: string): string | null {
  try {
    const first = readFileSync(path, "utf8").split("\n")[0];
    const value = JSON.parse(first);
    const cwd = value?.payload?.cwd;
    return cwd ? basename(cwd) : null;
  } catch {
    return null;
  }
}

function codexHasVisibleUserTurn(path: string): boolean {
  try {
    return readFileSync(path, "utf8").split("\n").some(line => {
      if (!line.trim()) return false;
      const value = JSON.parse(line);
      const payload = value.payload;
      if (value.type !== "response_item" || payload?.type !== "message" || payload?.role !== "user") return false;
      return Array.isArray(payload.content) && payload.content.some((item: any) => {
        const text = String(item.text ?? "").trim();
        return text
          && !text.startsWith("<user_shell_command>")
          && !text.startsWith("<environment_context>")
          && !text.startsWith("<permissions instructions>")
          && !text.startsWith("<skills_instructions>")
          && !text.startsWith("Continue working toward the active thread goal.");
      });
    });
  } catch {
    return false;
  }
}

function sqlite(path: string, sql: string): string {
  const dir = mkdtempSync(join(tmpdir(), "tokenscope-sqlite-"));
  const outfile = join(dir, "out.txt");

  try {
    const command = `sqlite3 -readonly ${shellQuote(path)} ${shellQuote(sql)} > ${shellQuote(outfile)}`;
    execSync(command, { stdio: ["ignore", "ignore", "pipe"], maxBuffer: 1024 * 1024 });
    return readFileSync(outfile, "utf8");
  } catch (error) {
    throw new Error(`sqlite3 failed for ${path}: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function safeReadDir(path: string): string[] {
  try {
    return readdirSync(path);
  } catch {
    return [];
  }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function splitFirst(value: string, separator: string): [string, string] | [null, null] {
  const index = value.indexOf(separator);
  if (index === -1) return [null, null];
  return [value.slice(0, index), value.slice(index + separator.length)];
}

function color(style: "bold" | "dim" | "green" | "yellow" | "red" | "cyan" | "magenta", text: string): string {
  if (!process.stdout.isTTY) return text;
  const codes = {
    bold: "\x1b[1m",
    dim: "\x1b[2m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    red: "\x1b[31m",
    cyan: "\x1b[36m",
    magenta: "\x1b[35m",
  };
  return `${codes[style]}${text}\x1b[0m`;
}

function printBox(lines: string[], style: "rounded" | "card" = "card") {
  const innerWidth = Math.min(
    74,
    Math.max(44, ...lines.map(line => stripAnsi(line).length)),
  );
  const width = innerWidth + 4;
  const top = style === "rounded" ? `╭${"─".repeat(width - 2)}╮` : `┌${"─".repeat(width - 2)}┐`;
  const bottom = style === "rounded" ? `╰${"─".repeat(width - 2)}╯` : `└${"─".repeat(width - 2)}┘`;

  console.log(color("dim", top));
  for (const line of lines) {
    const padded = pad(truncateVisible(line, innerWidth), innerWidth);
    console.log(`${color("dim", "│")} ${padded} ${color("dim", "│")}`);
  }
  console.log(color("dim", bottom));
}

function truncateVisible(value: string, max: number): string {
  if (stripAnsi(value).length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

function scoreBar(score: number, width = 18): string {
  const filled = Math.max(0, Math.min(width, Math.round((score / 100) * width)));
  const empty = width - filled;
  const fillColor = score >= 70 ? "green" : score >= 40 ? "yellow" : "red";
  return color(fillColor, "█".repeat(filled)) + color("dim", "░".repeat(empty));
}

function verdictFromScore(score: number) {
  if (score >= 70) {
    return {
      badge: color("green", "● 양호"),
      hint: "세션 품질이 좋습니다. 목표가 바뀔 때만 새 세션을 여세요.",
    };
  }
  if (score >= 40) {
    return {
      badge: color("yellow", "● 주의"),
      hint: "낭비 신호가 있습니다. 다음 요청은 범위와 완료 조건을 더 좁혀 보세요.",
    };
  }
  return {
    badge: color("red", "● 위험"),
    hint: "토큰 낭비가 큽니다. 세션을 나누고 질문 코치로 요청을 줄여 보세요.",
  };
}

function relativeTime(unix: number): string {
  const diffMs = Date.now() - unix * 1000;
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "방금 전";
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.floor(hours / 24);
  return `${days}일 전`;
}

function providerBadge(provider: Provider): string {
  if (provider === "claude") return color("yellow", "Claude");
  if (provider === "gemini") return color("cyan", "Gemini");
  if (provider === "codex") return color("green", "Codex");
  return color("magenta", "Cursor");
}

function formatDuration(start: string, end: string): string {
  if (!start || !end) return "—";
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 0) return "—";
  const minutes = Math.floor(ms / 60000);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) return `${hours}시간 ${minutes % 60}분`;
  if (minutes > 0) return `${minutes}분`;
  return "1분 미만";
}

function formatBreakdownLines(breakdown: ReturnType<typeof analyzeOne>["result"]["scoreBreakdown"]): string[] {
  const rows: Array<[string, number]> = [
    ["캐시 적중률", breakdown.cacheEfficiency],
    ["도구 성공률", breakdown.toolSuccessRate],
    ["컨텍스트 밀도", breakdown.contextDensity],
    ["설정 최적화", breakdown.claudeMdHealth],
    ["재시도 억제", breakdown.retryHealth],
    ["세션 집중도", breakdown.actionFocus],
  ];
  return rows.map(([label, score]) => `${pad(label, 12)} ${scoreBar(score, 12)} ${formatScore(score)}`);
}

function buildSmartTip(rows: SessionListRow[]): string {
  const patterns = rows
    .flatMap(row => row.analysis?.result.patterns ?? [])
    .sort((a, b) => b.estimatedWastedTokens - a.estimatedWastedTokens);

  if (patterns.length === 0) {
    return color("green", "최근 세션은 전반적으로 양호합니다. 새 목표는 새 세션에서 시작하세요.");
  }

  const top = patterns[0];
  const tips: Record<string, string> = {
    CONTEXT_BLOAT: "전역 설정 파일이 큽니다. 필수 지침만 남기고 나머지는 프로젝트별로 분리하세요.",
    RETRY_STORM: "같은 요청이 반복되고 있습니다. 실패 3회 후 전략을 바꾸는 규칙을 추가하세요.",
    TOOL_THRASH: "도구 호출이 연속 실패 중입니다. 입력 검증과 중단 기준을 먼저 적어 보세요.",
    SESSION_SCOPE_DRIFT: "한 세션에 작업이 섞였습니다. 목표가 바뀔 때 새 세션을 여세요.",
    PHASE_MIXING: "기획과 구현이 한 세션에 있습니다. 기획 요약 후 구현은 새 세션에서 시작하세요.",
    BROAD_REQUEST: "요청이 넓습니다. 파일·범위·완료 조건을 한 문장에 넣어 다시 요청하세요.",
  };

  const tip = tips[top.type] ?? "가장 큰 낭비 패턴부터 줄여 보세요.";
  return `${color("bold", "💡")} ${color("yellow", top.title)}: ${tip}`;
}

function pad(value: string, width: number, align: "left" | "right" = "left"): string {
  const plain = stripAnsi(value);
  const padding = Math.max(0, width - plain.length);
  if (align === "right") return " ".repeat(padding) + value;
  return value + " ".repeat(padding);
}

function stripAnsi(value: string): string {
  return value.replace(/\x1b\[[0-9;]*m/g, "");
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1))}…`;
}

function decodeProjectName(raw: string): string {
  try {
    return decodeURIComponent(raw.replace(/-/g, "/")).split("/").filter(Boolean).pop() ?? raw;
  } catch {
    return raw;
  }
}

function formatSessionDate(unix: number): string {
  const date = new Date(unix * 1000);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${month}/${day} ${hour}:${minute}`;
}

function formatScore(score: number, colored = true): string {
  const label = `${score}점`;
  if (!colored) return label;
  if (score >= 70) return color("green", label);
  if (score >= 40) return color("yellow", label);
  return color("red", label);
}

function formatTokenCount(value: number, colored = true): string {
  const label = value >= 1000 ? `${(value / 1000).toFixed(1)}K` : String(value);
  return colored ? label : label;
}

function getTotalTokens(session: ReturnType<typeof analyzeOne>["result"]["session"]): number {
  return session.totalInputTokens + session.totalOutputTokens + session.totalCacheReadTokens;
}

function formatPatternsLine(patterns: ReturnType<typeof analyzeOne>["result"]["patterns"]): string {
  if (patterns.length === 0) return color("green", "패턴 없음 · 효율적으로 사용 중");

  const sorted = [...patterns].sort((a, b) => b.estimatedWastedTokens - a.estimatedWastedTokens);
  const labels = sorted.slice(0, 2).map(pattern => formatPatternLabel(pattern));
  const suffix = sorted.length > 2 ? color("dim", ` 외 ${sorted.length - 2}개`) : "";
  return `${color("dim", "패턴")} ${labels.join(color("dim", "  "))}${suffix}`;
}

function formatPatternLabel(pattern: ReturnType<typeof analyzeOne>["result"]["patterns"][number]): string {
  const severity = pattern.severity.toLowerCase();
  const title = pattern.title;
  const wasted = color("dim", ` (${formatTokenCount(pattern.estimatedWastedTokens, false)})`);

  if (severity === "high") return color("red", title) + wasted;
  if (severity === "medium") return color("yellow", title) + wasted;
  return title + wasted;
}

function providerLabel(provider: Provider): string {
  if (provider === "claude") return "Claude";
  if (provider === "gemini") return "Gemini";
  if (provider === "codex") return "Codex";
  return "Cursor";
}

function printHelp() {
  printCliBanner("로컬 AI 세션 진단 CLI");
  printBox([
    `${color("bold", "Usage")}`,
    `list    [--provider claude|gemini|codex|cursor] [--limit 20] [--sort latest|score] [--quick] [-v]`,
    `analyze [session-path] [--format markdown|json|jsonl|langchain-jsonl]`,
    `export  [session-path] [--provider cursor] [--limit 20] [--langchain]`,
    "",
    `${color("bold", "Examples")}`,
    `yarn cli list --provider cursor --limit 5`,
    `yarn cli list --sort score --verbose`,
    `yarn cli analyze --format json`,
    `yarn cli export --provider cursor --limit 10 --langchain > cursor-sessions.jsonl`,
    "",
    `${color("bold", "LangChain")}`,
    `export --langchain → JSONL Document per session`,
  ], "rounded");
  console.log("");
}

function fail(message: string): never {
  console.error(`tokenscope: ${message}`);
  process.exit(1);
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (!isDirectRun) {
  // Keep this file safe to import in smoke tests.
}
