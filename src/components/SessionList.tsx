import { useState } from "react";
import { SessionFile } from "../lib/types";
import { DiagnosticResult } from "../lib/analyzer";
import { isHumanVisibleMessage } from "../lib/parser";

type SortMode = "latest" | "score";
type SessionListTheme = "default" | "cmux";

interface Props {
  sessions: SessionFile[];
  selectedPath: string | null;
  onSelect: (session: SessionFile) => void;
  loading: boolean;
  error: string | null;
  diagnostics?: Map<string, DiagnosticResult>;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  return `${(bytes / 1024).toFixed(1)}KB`;
}

function formatTime(unix: number): string {
  const d = new Date(unix * 1000);
  return d.toLocaleDateString("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function scoreColor(s: number) {
  return s >= 70 ? "var(--green)" : s >= 40 ? "var(--orange)" : "var(--red)";
}

function providerStyle(provider: string) {
  switch (provider.toLowerCase()) {
    case "claude": return { bg: "rgba(217, 119, 87, 0.1)", color: "#d97757", label: "Claude" };
    case "gemini": return { bg: "rgba(66, 133, 244, 0.1)", color: "#4285f4", label: "Gemini" };
    case "codex":  return { bg: "rgba(16, 163, 127, 0.1)", color: "#10a37f", label: "Codex" };
    default:       return { bg: "var(--border)", color: "var(--text-muted)", label: provider };
  }
}

export function SessionList({ sessions, selectedPath, onSelect, loading, error, diagnostics }: Props) {
  const [sortMode, setSortMode] = useState<SortMode>("latest");
  const [theme, setTheme] = useState<SessionListTheme>(() => {
    const saved = localStorage.getItem("tokenscope.sessionListTheme");
    return saved === "cmux" ? "cmux" : "default";
  });

  const updateTheme = (next: SessionListTheme) => {
    setTheme(next);
    localStorage.setItem("tokenscope.sessionListTheme", next);
  };

  if (loading) return <div className="empty"><span className="spinner" /></div>;
  if (error)   return <div className="empty">{error}</div>;
  if (sessions.length === 0) {
    return (
      <div className="empty">
        세션 파일을 찾지 못했습니다.<br />
        Claude Code를 실행한 적이 있는지 확인하세요.
      </div>
    );
  }

  const visibleSessions = theme === "cmux" ? compactCmuxSessions(sessions) : sessions;
  const sorted = [...visibleSessions].sort((a, b) => {
    if (theme === "cmux") {
      const ao = a.external_session_order;
      const bo = b.external_session_order;
      if (ao !== undefined && bo !== undefined && ao !== bo) return ao - bo;
      if (ao !== undefined && bo === undefined) return -1;
      if (ao === undefined && bo !== undefined) return 1;
    }

    if (sortMode === "score") {
      const sa = diagnostics?.get(a.path)?.healthScore;
      const sb = diagnostics?.get(b.path)?.healthScore;
      if (sa === undefined && sb === undefined) return b.modified - a.modified;
      if (sa === undefined) return 1;
      if (sb === undefined) return -1;
      return sa - sb; // 낮은 점수(문제 많은) 먼저
    }
    return b.modified - a.modified; // 최신순
  });

  return (
    <div>
      <div className="session-toolbar">
        <div className="session-sort">
          <button
            className={`btn ${sortMode === "latest" ? "primary" : "ghost"}`}
            onClick={() => setSortMode("latest")}
          >최신순</button>
          <button
            className={`btn ${sortMode === "score" ? "primary" : "ghost"}`}
            onClick={() => setSortMode("score")}
          >점수순</button>
        </div>
        <div className="session-theme">
          <button
            className={theme === "default" ? "active" : ""}
            onClick={() => updateTheme("default")}
            title="첫 요청과 시작 폴더 기준으로 표시"
          >기본</button>
          <button
            className={theme === "cmux" ? "active" : ""}
            onClick={() => updateTheme("cmux")}
            title="cmux 세션명을 우선 표시"
          >cmux</button>
        </div>
      </div>

      {sorted.map(s => {
        const diag = diagnostics?.get(s.path);
        const provider = diag?.session.provider ?? "claude";
        const pStyle = providerStyle(provider);
        const display = getSessionDisplay(s, diag, theme);

        return (
          <div
            key={s.path}
            className={`session-item${selectedPath === s.path ? " active" : ""}`}
            onClick={() => onSelect(s)}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
              <div className="session-project" title={display.title} style={{ flex: 1 }}>
                {display.title}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                <span style={{
                  fontSize: 9,
                  fontWeight: 800,
                  padding: "2px 5px",
                  borderRadius: 4,
                  backgroundColor: pStyle.bg,
                  color: pStyle.color,
                  textTransform: "uppercase",
                  letterSpacing: "0.02em"
                }}>
                  {pStyle.label}
                </span>
                {diag && (
                  <span style={{ fontSize: 11, fontWeight: 700, color: scoreColor(diag.healthScore) }}>
                    {diag.healthScore}점
                  </span>
                )}
              </div>
            </div>
            <div className="session-id" title={display.subtitle}>{display.subtitle}</div>
            {display.context && <div className="session-context" title={display.context}>{display.context}</div>}
            <div className="session-meta">{formatTime(s.modified)} · {formatBytes(s.size_bytes)}</div>
          </div>
        );
      })}
    </div>
  );
}

function decodeProjectName(raw: string): string {
  try {
    return decodeURIComponent(raw.replace(/-/g, "/")).split("/").filter(Boolean).pop() ?? raw;
  } catch { return raw; }
}

function getSessionDisplay(session: SessionFile, diagnostic: DiagnosticResult | undefined, theme: SessionListTheme) {
  const userMessages = diagnostic?.session.messages
    .filter(m => m.role === "user" && isHumanVisibleMessage(m) && m.contentText.trim().length > 0) ?? [];
  const firstRequest = summarizeRequest(userMessages[0]?.contentText);
  const recentRequest = summarizeRequest(userMessages[userMessages.length - 1]?.contentText);
  const projectPath = compactPath(session.project_path);
  const projectName = decodeProjectName(session.project);
  const fallbackTitle = firstRequest || projectName || session.session_id.slice(0, 18);

  if (theme === "cmux" && session.external_session_name) {
    return {
      title: summarizeRequest(session.external_session_name, 54),
      subtitle: ["cmux", projectPath || projectName].filter(Boolean).join(" · "),
      context: firstRequest ? `첫 요청: ${firstRequest}` : undefined,
    };
  }

  return {
    title: fallbackTitle,
    subtitle: projectPath || projectName,
    context: recentRequest && recentRequest !== firstRequest ? `최근: ${recentRequest}` : undefined,
  };
}

function compactCmuxSessions(sessions: SessionFile[]): SessionFile[] {
  const byCmuxWorkspace = new Map<number, SessionFile>();
  const rest: SessionFile[] = [];

  for (const session of sessions) {
    const order = session.external_session_order;
    if (order === undefined) {
      rest.push(session);
      continue;
    }

    const previous = byCmuxWorkspace.get(order);
    if (!previous || session.modified > previous.modified) {
      byCmuxWorkspace.set(order, session);
    }
  }

  return [...byCmuxWorkspace.values(), ...rest];
}

function summarizeRequest(raw: string | undefined, max = 58): string {
  if (!raw) return "";
  const text = raw
    .replace(/<[^>]+>[\s\S]*?<\/[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function compactPath(path: string | undefined): string {
  if (!path) return "";
  const parts = path.split("/").filter(Boolean);
  if (parts.length <= 2) return path;
  return parts.slice(-2).join("/");
}
