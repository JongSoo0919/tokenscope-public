// Actual JSONL/JSON schema from ~/.claude/projects/**/*.jsonl and ~/.gemini/tmp/**/*.json
// Supports multiple providers: Claude, Gemini, Codex, Cursor

import { Provider, detectProvider, PROVIDER_CONFIGS } from "./providers";

export interface RawEntry {
  type?: "user" | "assistant" | "gemini" | "info" | "error" | "file-history-snapshot" | string;
  uuid?: string;
  id?: string; // Gemini uses 'id' instead of 'uuid'
  parentUuid?: string;
  sessionId?: string;
  timestamp?: string;
  startTime?: string;
  cwd?: string;
  message?: RawMessage; // Claude style
  content?: string | RawContentBlock[]; // Gemini style direct content
  tokens?: RawUsage; // Gemini style direct tokens
  model?: string; // Gemini style direct model
  toolCalls?: any[]; // Gemini style tool calls
  messages?: RawEntry[]; // Nested messages in .json format
  payload?: any; // Codex style event payload
  fixtureConfigMd?: string;
  fixtureName?: string;
}

export interface RawMessage {
  role: "user" | "assistant";
  model?: string;
  content?: string | RawContentBlock[];
  usage?: RawUsage;
}

export interface RawUsage {
  [key: string]: number | undefined;
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  // Gemini fields
  input?: number;
  output?: number;
  cached?: number;
  total?: number;
  // Codex/OpenAI fields
  prompt_tokens?: number;
  completion_tokens?: number;
  cached_input_tokens?: number;
  reasoning_output_tokens?: number;
}

export interface RawContentBlock {
  type?: "text" | "tool_use" | "tool_result" | "thinking" | "error" | string;
  text?: string;
  content?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  is_error?: boolean;
  functionResponse?: {
    name: string;
    response: { output: string };
  };
}

export interface ParsedMessage {
  uuid: string;
  role: "user" | "assistant";
  contentText: string;
  contentBlocks: RawContentBlock[];
  isToolUse: boolean;
  isToolResult: boolean;
  toolName?: string;
  toolUseId?: string;
  isToolError?: boolean;
  usage?: RawUsage;
  model?: string;
  timestamp: string;
}

export function isHumanVisibleMessage(message: ParsedMessage): boolean {
  if (message.isToolResult || message.isToolUse) return false;
  const text = message.contentText.trim();
  if (!text) return false;
  if (text.startsWith("<user_info>")) return false;
  if (text.startsWith("<git_status>")) return false;
  if (text.startsWith("<agent_transcripts>")) return false;
  if (text.startsWith("<rules>")) return false;
  if (text.startsWith("<agent_skills>")) return false;
  if (text.startsWith("<user_shell_command>")) return false;
  if (text.startsWith("<environment_context>")) return false;
  if (text.startsWith("<permissions instructions>")) return false;
  if (text.startsWith("<skills_instructions>")) return false;
  if (text.startsWith("Continue working toward the active thread goal.")) return false;
  return true;
}

export interface SessionData {
  sessionId: string;
  project: string;
  filePath: string;
  messages: ParsedMessage[];
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheCreationTokens: number;
  model: string;
  provider: Provider;
  startTime: string;
  endTime: string;
  parseErrors: number;
  fixtureConfigMd?: string;
  fixtureName?: string;
}

export function parseSession(raw: string, sessionId: string, project: string, filePath: string): SessionData {
  const isJsonArray = raw.trim().startsWith('{') && raw.trim().endsWith('}') && !raw.trim().includes('\n{');
  
  if (isJsonArray) {
    try {
      const data = JSON.parse(raw);
      if (data.messages && Array.isArray(data.messages)) {
        return processGeminiJsonObject(data, sessionId, project, filePath);
      }
    } catch (e) {
      // Fallback to line-by-line if JSON parse fails
    }
  }

  return parseJsonl(raw, sessionId, project, filePath);
}

function processGeminiJsonObject(data: any, sessionId: string, project: string, filePath: string): SessionData {
  const messages: ParsedMessage[] = [];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCacheReadTokens = 0;
  let totalCacheCreationTokens = 0;
  let model = data.model || "gemini-unknown";
  let startTime = data.startTime || "";
  let endTime = data.lastUpdated || "";

  for (const msg of data.messages) {
    const parsed = normalizeEntry(msg);
    if (parsed) {
      messages.push(parsed);
      if (parsed.usage) {
        totalInputTokens += parsed.usage.input ?? parsed.usage.input_tokens ?? 0;
        totalOutputTokens += parsed.usage.output ?? parsed.usage.output_tokens ?? 0;
        totalCacheReadTokens += parsed.usage.cached ?? parsed.usage.cache_read_input_tokens ?? 0;
      }
    }
  }

  return {
    sessionId: data.sessionId || sessionId,
    project,
    filePath,
    messages,
    totalInputTokens,
    totalOutputTokens,
    totalCacheReadTokens,
    totalCacheCreationTokens,
    model,
    provider: "gemini",
    startTime,
    endTime,
    parseErrors: 0,
  };
}

function parseJsonl(raw: string, sessionId: string, project: string, filePath: string): SessionData {
  const lines = raw.split("\n").filter(l => l.trim().length > 0);
  const messages: ParsedMessage[] = [];
  let parseErrors = 0;

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCacheReadTokens = 0;
  let totalCacheCreationTokens = 0;
  let model = "unknown";
  let provider: Provider = filePath.includes("/.cursor/chats/")
    || filePath.includes("/Library/Application Support/Cursor/")
    || project === "cursor"
    ? "cursor"
    : filePath.includes("/.codex/") || project === "codex" ? "codex" : "claude";
  let startTime = "";
  let endTime = "";
  let fixtureConfigMd: string | undefined;
  let fixtureName: string | undefined;

  for (const line of lines) {
    if (line.startsWith('{"$set"')) continue;

    let entry: RawEntry;
    try {
      entry = JSON.parse(line);
    } catch {
      parseErrors++;
      continue;
    }

    if (entry.type === "session_meta" && entry.payload) {
      provider = entry.payload.model_provider === "openai" ? "codex" : provider;
      model = entry.payload.model ?? (provider === "codex" ? "codex" : model);
      if (entry.payload.timestamp) startTime = entry.payload.timestamp;
      continue;
    }

    if (entry.type === "cursor_meta" && entry.payload) {
      provider = "cursor";
      model = entry.payload.lastUsedModel ?? entry.payload.model ?? "cursor";
      if (entry.payload.createdAt) startTime = normalizeCursorTimestamp(entry.payload.createdAt);
      continue;
    }

    if (entry.type === "tokenscope_fixture") {
      fixtureConfigMd = entry.fixtureConfigMd;
      fixtureName = entry.fixtureName;
      provider = "codex";
      model = "tokenscope-dogfood";
      if (entry.timestamp) startTime = entry.timestamp;
      continue;
    }

    if (entry.type === "event_msg" && entry.payload?.type === "token_count") {
      const last = entry.payload.info?.last_token_usage;
      if (last) {
        totalInputTokens += last.input_tokens ?? 0;
        totalOutputTokens += (last.output_tokens ?? 0) + (last.reasoning_output_tokens ?? 0);
        totalCacheReadTokens += last.cached_input_tokens ?? 0;
      }
      if (entry.timestamp && entry.timestamp > endTime) endTime = entry.timestamp;
      continue;
    }

    if (entry.sessionId && !entry.type) {
      if (entry.startTime) startTime = entry.startTime;
      continue;
    }

    if (entry.type === "file-history-snapshot" || entry.type === "info") continue;

    const parsed = normalizeEntry(entry);
    if (!parsed) continue;

    if (parsed.model) {
      model = parsed.model;
      if (provider !== "cursor") provider = detectProvider(model);
    }

    const timestamp = parsed.timestamp;
    if (!startTime || (timestamp && timestamp < startTime)) startTime = timestamp;
    if (timestamp && timestamp > endTime) endTime = timestamp;

    if (parsed.usage) {
      const config = PROVIDER_CONFIGS[provider];
      const fieldNames = config.jsonlFormat.usageFieldNames;

      totalInputTokens += parsed.usage[fieldNames.input] ?? parsed.usage.input ?? 0;
      totalOutputTokens += parsed.usage[fieldNames.output] ?? parsed.usage.output ?? 0;

      if (config.supportsCache) {
        totalCacheReadTokens += (fieldNames.cacheRead ? parsed.usage[fieldNames.cacheRead] : 0) ?? parsed.usage.cached ?? 0;
      }
    } else if (provider === "cursor") {
      const estimated = estimateTokens(parsed.contentText);
      if (parsed.role === "assistant") {
        totalOutputTokens += estimated;
      } else {
        totalInputTokens += estimated;
      }
    }

    messages.push(parsed);
  }

  return {
    sessionId, project, filePath, messages,
    totalInputTokens, totalOutputTokens, totalCacheReadTokens, totalCacheCreationTokens,
    model, provider, startTime, endTime, parseErrors, fixtureConfigMd, fixtureName,
  };
}

function normalizeEntry(entry: RawEntry): ParsedMessage | null {
  let role: "user" | "assistant" | undefined;
  let content: string | RawContentBlock[] | undefined;
  let usage: RawUsage | undefined;
  let model: string | undefined;

  if (entry.type === "response_item" && entry.payload) {
    return normalizeCodexResponseItem(entry);
  }

  if (entry.type === "cursor_message" && entry.payload) {
    return normalizeCursorMessage(entry);
  }

  if (entry.message) {
    // Claude style
    role = entry.message.role;
    content = entry.message.content;
    usage = entry.message.usage;
    model = entry.message.model;
  } else if (entry.type === "user" || entry.type === "gemini" || entry.type === "assistant") {
    // Gemini style
    role = (entry.type === "gemini" || entry.type === "assistant") ? "assistant" : "user";
    content = entry.content;
    usage = entry.tokens;
    model = entry.model;
  }

  if (!role) return null;

  const blocks: RawContentBlock[] = Array.isArray(content) ? content : [];
  const toolCalls = entry.toolCalls ?? [];
  const isToolUse = toolCalls.length > 0 || blocks.some(b => b.type === "tool_use");
  const isToolResult = blocks.some(b => b.type === "tool_result" || b.functionResponse);

  let contentText = "";
  if (typeof content === "string") {
    contentText = content;
  } else if (Array.isArray(content)) {
    contentText = blocks
      .map(b => b.text ?? b.content ?? b.functionResponse?.response?.output ?? "")
      .filter(t => typeof t === "string")
      .join("\n");
  }

  if (!contentText && toolCalls.length > 0) {
    contentText = toolCalls.map(tc => `Calling ${tc.name}...`).join("\n");
  }

  return {
    uuid: entry.id ?? entry.uuid ?? Math.random().toString(36).substring(7),
    role,
    contentText,
    contentBlocks: blocks,
    isToolUse,
    isToolResult,
    toolName: toolCalls[0]?.name || blocks.find(b => b.type === "tool_use")?.name,
    toolUseId: toolCalls[0]?.id || blocks.find(b => b.type === "tool_use")?.id || (blocks.find(b => b.functionResponse) as any)?.functionResponse?.id,
    isToolError: blocks.some(b => b.is_error || b.type === "error"),
    usage,
    model,
    timestamp: entry.timestamp || "",
  };
}

function normalizeCursorMessage(entry: RawEntry): ParsedMessage | null {
  const payload = entry.payload;
  const cursorRole = payload?.role;
  if (!cursorRole || cursorRole === "system") return null;

  const role: "user" | "assistant" = cursorRole === "assistant" ? "assistant" : "user";
  const rawContent = payload.content;
  const rawBlocks = Array.isArray(rawContent) ? rawContent : [];
  const blocks: RawContentBlock[] = rawBlocks.map((block: any) => ({
    type: block.type,
    text: block.text,
    content: block.text ?? block.content,
    id: block.toolCallId ?? block.id,
    name: block.toolName ?? block.name,
    input: block.args ?? block.input,
    tool_use_id: block.toolCallId,
    is_error: block.isError,
  }));

  let contentText = "";
  if (typeof rawContent === "string") {
    contentText = sanitizeCursorContent(rawContent);
  } else if (rawBlocks.length > 0) {
    contentText = rawBlocks
      .map((block: any) => block.text ?? block.content ?? block.result ?? block.args ?? "")
      .map((value: unknown) => typeof value === "string" ? value : JSON.stringify(value))
      .filter(Boolean)
      .join("\n");
    contentText = sanitizeCursorContent(contentText);
  }

  const isToolUse = cursorRole === "assistant" && rawBlocks.some((b: any) => b.type === "tool-call" || b.toolCallId);
  const isToolResult = cursorRole === "tool" || rawBlocks.some((b: any) => b.type === "tool-result");
  const firstTool = rawBlocks.find((b: any) => b.type === "tool-call" || b.type === "tool-result" || b.toolCallId);

  if (!contentText && isToolUse && firstTool?.toolName) {
    contentText = `Calling ${firstTool.toolName}...`;
  }

  return {
    uuid: payload.id ?? entry.id ?? Math.random().toString(36).substring(7),
    role,
    contentText,
    contentBlocks: blocks,
    isToolUse,
    isToolResult,
    toolName: firstTool?.toolName ?? firstTool?.name,
    toolUseId: firstTool?.toolCallId ?? firstTool?.id,
    isToolError: blocks.some(b => b.is_error || isLikelyToolError(b.content ?? b.text ?? "")),
    usage: payload.usage,
    model: payload.model,
    timestamp: normalizeCursorTimestamp(payload.createdAt ?? payload.timestamp ?? payload.time ?? ""),
  };
}

function sanitizeCursorContent(text: string): string {
  const userQueryMatch = text.match(/<user_query>\s*([\s\S]*?)\s*<\/user_query>/);
  if (userQueryMatch) return userQueryMatch[1].trim();

  const withoutTimestamp = text.replace(/<timestamp>[\s\S]*?<\/timestamp>/g, "").trim();
  if (
    withoutTimestamp.startsWith("<user_info>") ||
    withoutTimestamp.startsWith("<git_status>") ||
    withoutTimestamp.startsWith("<agent_transcripts>") ||
    withoutTimestamp.startsWith("<rules>") ||
    withoutTimestamp.startsWith("<agent_skills>")
  ) {
    return "";
  }

  return withoutTimestamp;
}

function normalizeCursorTimestamp(value: unknown): string {
  if (typeof value === "number") {
    const millis = value > 10_000_000_000 ? value : value * 1000;
    return new Date(millis).toISOString();
  }
  if (typeof value === "string" && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return normalizeCursorTimestamp(numeric);
    return value;
  }
  return "";
}

function normalizeCodexResponseItem(entry: RawEntry): ParsedMessage | null {
  const payload = entry.payload;
  const payloadType = payload?.type;

  if (payloadType === "message") {
    const role = payload.role;
    if (role !== "user" && role !== "assistant") return null;

    const contentItems = Array.isArray(payload.content) ? payload.content : [];
    const contentText = contentItems
      .map((item: any) => item.text ?? "")
      .filter((text: unknown) => typeof text === "string")
      .join("\n");

    return {
      uuid: payload.id ?? entry.id ?? entry.uuid ?? Math.random().toString(36).substring(7),
      role,
      contentText,
      contentBlocks: contentItems.map((item: any) => ({ type: item.type, text: item.text })),
      isToolUse: false,
      isToolResult: false,
      model: payload.model,
      timestamp: entry.timestamp || "",
    };
  }

  if (payloadType === "function_call") {
    return {
      uuid: payload.call_id ?? entry.id ?? Math.random().toString(36).substring(7),
      role: "assistant",
      contentText: `Calling ${payload.name}...`,
      contentBlocks: [{ type: "tool_use", name: payload.name, id: payload.call_id, input: safeParseJson(payload.arguments) }],
      isToolUse: true,
      isToolResult: false,
      toolName: payload.name,
      toolUseId: payload.call_id,
      timestamp: entry.timestamp || "",
    };
  }

  if (payloadType === "function_call_output") {
    const output = String(payload.output ?? "");
    return {
      uuid: payload.call_id ?? entry.id ?? Math.random().toString(36).substring(7),
      role: "user",
      contentText: output,
      contentBlocks: [{ type: "tool_result", tool_use_id: payload.call_id, content: output, is_error: isLikelyToolError(output) }],
      isToolUse: false,
      isToolResult: true,
      toolUseId: payload.call_id,
      isToolError: isLikelyToolError(output),
      timestamp: entry.timestamp || "",
    };
  }

  return null;
}

function safeParseJson(value: unknown): Record<string, unknown> {
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function isLikelyToolError(output: string): boolean {
  const lower = output.toLowerCase();
  return lower.includes("error") || lower.includes("failed") || lower.includes("permission denied") || lower.includes("exit code");
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3);
}

export interface ClaudeSection {
  heading: string;
  content: string;
  estimatedTokens: number;
}

export function parseClaudeMd(content: string): ClaudeSection[] {
  if (!content.trim()) return [];
  const lines = content.split("\n");
  const sections: ClaudeSection[] = [];
  let currentHeading = "(preface)";
  let currentLines: string[] = [];

  const flush = () => {
    const text = currentLines.join("\n").trim();
    if (text) {
      sections.push({
        heading: currentHeading,
        content: text,
        estimatedTokens: estimateTokens(text),
      });
    }
  };

  for (const line of lines) {
    if (line.startsWith("## ")) {
      flush();
      currentHeading = line.slice(3).trim();
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }
  flush();
  return sections;
}
