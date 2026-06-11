import { useState } from "react";
import { SessionFile } from "../lib/types";
import { DiagnosticResult } from "../lib/analyzer";

type SortMode = "latest" | "score";

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
    case "cursor": return { bg: "rgba(139, 92, 246, 0.12)", color: "#8b5cf6", label: "Cursor" };
    default:       return { bg: "var(--border)", color: "var(--text-muted)", label: provider };
  }
}

export function SessionList({ sessions, selectedPath, onSelect, loading, error, diagnostics }: Props) {
  const [sortMode, setSortMode] = useState<SortMode>("latest");

  if (loading) return <div className="empty"><span className="spinner" /></div>;
  if (error)   return <div className="empty">{error}</div>;
  if (sessions.length === 0) {
    return (
      <div className="empty">
        세션 파일을 찾지 못했습니다.<br />
        Claude, Gemini, Codex, Cursor를 실행한 적이 있는지 확인하세요.
      </div>
    );
  }

  const sorted = [...sessions].sort((a, b) => {
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
      {/* 정렬 토글 */}
      <div style={{ display: "flex", gap: 6, padding: "8px 10px", borderBottom: "1px solid var(--border)" }}>
        <button
          className={`btn ${sortMode === "latest" ? "primary" : "ghost"}`}
          style={{ flex: 1, fontSize: 11, padding: "4px 6px" }}
          onClick={() => setSortMode("latest")}
        >최신순</button>
        <button
          className={`btn ${sortMode === "score" ? "primary" : "ghost"}`}
          style={{ flex: 1, fontSize: 11, padding: "4px 6px" }}
          onClick={() => setSortMode("score")}
        >점수순</button>
      </div>

      {sorted.map(s => {
        const diag = diagnostics?.get(s.path);
        const provider = diag?.session.provider ?? inferProviderFromPath(s.path);
        const pStyle = providerStyle(provider);

        return (
          <div
            key={s.path}
            className={`session-item${selectedPath === s.path ? " active" : ""}`}
            onClick={() => onSelect(s)}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
              <div className="session-project" title={s.project} style={{ flex: 1 }}>
                {decodeProjectName(s.project)}
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
            <div className="session-id" title={s.session_id}>{s.session_id.slice(0, 18)}…</div>
            <div className="session-meta">{formatTime(s.modified)} · {formatBytes(s.size_bytes)}</div>
          </div>
        );
      })}
    </div>
  );
}

function inferProviderFromPath(path: string): string {
  if (path.includes("/.cursor/chats/")) return "cursor";
  if (path.includes("/Library/Application Support/Cursor/")) return "cursor";
  if (path.includes("/.codex/")) return "codex";
  if (path.includes("/.gemini/") || path.includes("/.omc/")) return "gemini";
  return "claude";
}

function decodeProjectName(raw: string): string {
  try {
    return decodeURIComponent(raw.replace(/-/g, "/")).split("/").filter(Boolean).pop() ?? raw;
  } catch { return raw; }
}
