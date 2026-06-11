import { useState } from "react";
import { SessionFile } from "../lib/types";
import { DiagnosticResult } from "../lib/analyzer";

type SortMode = "latest" | "score";
export type ProviderFilter = "all" | "claude" | "gemini" | "codex" | "cursor" | "wiki";

interface Props {
  sessions: SessionFile[];
  selectedPath: string | null;
  onSelect: (session: SessionFile) => void;
  providerFilter: ProviderFilter;
  onProviderFilterChange: (provider: ProviderFilter) => void;
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

export function SessionList({ sessions, selectedPath, onSelect, providerFilter, onProviderFilterChange, loading, error, diagnostics }: Props) {
  const [sortMode, setSortMode] = useState<SortMode>("latest");

  if (loading) return <div className="empty"><span className="spinner" /></div>;
  if (sessions.length === 0) {
    return (
      <div className="empty">
        {error ? (
          error
        ) : (
          <>
            세션 파일을 찾지 못했습니다.<br />
            Claude, Gemini, Codex, Cursor를 실행한 적이 있는지 확인하세요.
          </>
        )}
      </div>
    );
  }

  const providerCounts = buildProviderCounts(sessions, diagnostics);
  const filtered = sessions.filter(session => {
    if (providerFilter === "all") return true;
    return getSessionProvider(session, diagnostics) === providerFilter;
  });

  const sorted = [...filtered].sort((a, b) => {
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
      {error && (
        <div style={{
          margin: 10,
          padding: "8px 10px",
          borderRadius: 6,
          background: "rgba(239, 68, 68, 0.08)",
          border: "1px solid rgba(239, 68, 68, 0.22)",
          color: "var(--red)",
          fontSize: 11,
          lineHeight: 1.4,
        }}>
          {error}
        </div>
      )}

      {/* 정렬 토글 */}
      <div style={{ display: "flex", gap: 6, padding: "8px 10px 6px", borderBottom: "1px solid var(--border)" }}>
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

      <div style={{ display: "flex", gap: 6, padding: "8px 10px", borderBottom: "1px solid var(--border)", flexWrap: "wrap" }}>
        {providerOptions(providerCounts).map(option => (
          <button
            key={option.value}
            className={`btn ${providerFilter === option.value ? "primary" : "ghost"}`}
            style={{ fontSize: 10, padding: "4px 7px", borderRadius: 5 }}
            onClick={() => onProviderFilterChange(option.value)}
            title={`${option.label} ${option.count}개`}
          >
            {option.label} {option.count}
          </button>
        ))}
      </div>

      {sorted.length === 0 && (
        <div className="empty" style={{ padding: 16 }}>
          선택한 provider의 세션이 없습니다.
        </div>
      )}

      {sorted.map(s => {
        const diag = diagnostics?.get(s.path);
        const provider = getSessionProvider(s, diagnostics);
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

function getSessionProvider(session: SessionFile, diagnostics?: Map<string, DiagnosticResult>): string {
  return diagnostics?.get(session.path)?.session.provider ?? inferProviderFromPath(session.path);
}

function buildProviderCounts(sessions: SessionFile[], diagnostics?: Map<string, DiagnosticResult>): Record<ProviderFilter, number> {
  const counts: Record<ProviderFilter, number> = {
    all: sessions.length,
    claude: 0,
    gemini: 0,
    codex: 0,
    cursor: 0,
    wiki: 0,
  };
  for (const session of sessions) {
    const provider = getSessionProvider(session, diagnostics);
    if (provider in counts && provider !== "all") {
      counts[provider as ProviderFilter] += 1;
    }
  }
  return counts;
}

function providerOptions(counts: Record<ProviderFilter, number>): Array<{ value: ProviderFilter; label: string; count: number }> {
  const options: Array<{ value: ProviderFilter; label: string; count: number }> = [
    { value: "all", label: "전체", count: counts.all },
    { value: "claude", label: "Claude", count: counts.claude },
    { value: "codex", label: "Codex", count: counts.codex },
    { value: "cursor", label: "Cursor", count: counts.cursor },
    { value: "wiki", label: "WIKI", count: counts.wiki },
    { value: "gemini", label: "Gemini", count: counts.gemini },
  ];
  return options.filter(option => option.value === "all" || option.count > 0);
}

function inferProviderFromPath(path: string): string {
  if (path.includes("/.cursor/chats/")) return "cursor";
  if (path.includes("/.cursor/projects/")) return "cursor";
  if (path.includes("/Library/Application Support/Cursor/")) return "cursor";
  if (path.includes("/.codex/")) return "codex";
  if (path.includes("/tokenscope_rag/sessions/")) return "wiki";
  if (path.includes("/.gemini/") || path.includes("/.omc/")) return "gemini";
  return "claude";
}

function decodeProjectName(raw: string): string {
  try {
    return decodeURIComponent(raw.replace(/-/g, "/")).split("/").filter(Boolean).pop() ?? raw;
  } catch { return raw; }
}
