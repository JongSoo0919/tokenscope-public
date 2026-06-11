import { useEffect, useState, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { SessionList } from "./components/SessionList";
import { SummaryCard } from "./components/SummaryCard";
import { FixPreview } from "./components/FixPreview";
import { QuestionGuide } from "./components/QuestionGuide";
import { Dashboard } from "./components/Dashboard";
import { ConversationReview } from "./components/ConversationReview";
import { PromptCoachPanel } from "./components/PromptCoachPanel";
import { parseSession, isHumanVisibleMessage } from "./lib/parser";
import { analyzeSession, DiagnosticResult } from "./lib/analyzer";
import { prescribe, Fix, UsageWindowContext } from "./lib/prescriber";
import { SessionFile, ReadResult } from "./lib/types";

export default function App() {
  const [sessions, setSessions] = useState<SessionFile[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const [selected, setSelected] = useState<SessionFile | null>(null);
  const [diagnostic, setDiagnostic] = useState<DiagnosticResult | null>(null);
  const [diagnostics, setDiagnostics] = useState<Map<string, DiagnosticResult>>(new Map());
  const [fixes, setFixes] = useState<Fix[]>([]);
  const [claudeMd, setClaudeMd] = useState("");
  const [geminiMd, setGeminiMd] = useState("");
  const [codexMd, setCodexMd] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [activeTab, setActiveTab] = useState("summary");

  const [applying, setApplying] = useState(false);
  const [applyMsg, setApplyMsg] = useState<string | null>(null);
  const [lastBackup, setLastBackup] = useState<{ path: string; provider: string } | null>(null);

  const initialLoadDone = useRef(false);

  useEffect(() => {
    const init = async () => {
      try {
        const sessionList = await invoke<SessionFile[]>("list_sessions");
        const cMd = await invoke<string>("read_claude_md").catch(() => "");
        const gMd = await invoke<string>("read_gemini_md").catch(() => "");
        const xMd = await invoke<string>("read_codex_md").catch(() => "");
        setClaudeMd(cMd);
        setGeminiMd(gMd);
        setCodexMd(xMd);

        if (!initialLoadDone.current && sessionList.length > 0) {
          initialLoadDone.current = true;
          const results = new Map<string, DiagnosticResult>();
          
          for (const s of sessionList) {
            try {
              const res = await invoke<ReadResult>("read_session", { path: s.path });
              const parsed = parseSession(res.content, s.session_id, s.project, s.path);
              const configMd = getSessionConfigMd(parsed, cMd, gMd, xMd);
              const diag = analyzeSession(parsed, configMd);
              results.set(s.path, diag);
            } catch (e) {
              console.warn(`Initial analysis failed for ${s.path}`, e);
            }
          }
          setDiagnostics(results);
        }
        setSessions(sessionList);
        setLoadingList(false);
      } catch (e) {
        setListError(String(e));
        setLoadingList(false);
      }
    };
    init();
  }, []);

  const handleSelect = useCallback(async (session: SessionFile) => {
    setSelected(session);
    setDiagnostic(null);
    setFixes([]);
    setApplyMsg(null);
    setLastBackup(null);
    setAnalyzing(true);

    try {
      const result = await invoke<ReadResult>("read_session", { path: session.path });
      // use parseSession for both .json and .jsonl
      const parsed = parseSession(result.content, session.session_id, session.project, session.path);
      const currentConfigMd = getSessionConfigMd(parsed, claudeMd, geminiMd, codexMd);
      
      const diag = analyzeSession(parsed, currentConfigMd);
      const usageWindow = buildUsageWindowContext(diag, diagnostics);
      const fixList = prescribe(diag, currentConfigMd, usageWindow);
      
      setDiagnostic(diag);
      setFixes(fixList);
      setDiagnostics(prev => new Map(prev).set(session.path, diag));
    } catch (e) {
      console.error("Selection analysis failed", e);
      setListError(`세션 분석 실패: ${String(e)}`);
    } finally {
      setAnalyzing(false);
    }
  }, [claudeMd, geminiMd, codexMd, diagnostics]);

  const handleApplyFix = useCallback(async (fix: Fix) => {
    if (fix.action.kind !== "edit_config_md") return;
    const { suggestedContent, provider } = fix.action;

    setApplying(true);
    setApplyMsg(null);
    try {
      const homeDir = await invoke<string>("get_home_dir").catch(() => "~");
      const backupPath = await invoke<string>("write_config_md", {
        provider,
        content: suggestedContent,
        backupDir: `${homeDir}/.tokenscope/backups`,
      });
      
      if (provider === "gemini") setGeminiMd(suggestedContent);
      else if (provider === "codex") setCodexMd(suggestedContent);
      else setClaudeMd(suggestedContent);

      setApplyMsg(`저장 완료. 백업: ${backupPath}`);
      setLastBackup({ path: backupPath, provider });
      
      // Re-analyze
      if (selected) {
        const result = await invoke<ReadResult>("read_session", { path: selected.path });
        const parsed = parseSession(result.content, selected.session_id, selected.project, selected.path);
        const diag = analyzeSession(parsed, suggestedContent);
        const usageWindow = buildUsageWindowContext(diag, diagnostics);
        setDiagnostic(diag);
        setFixes(prescribe(diag, suggestedContent, usageWindow));
      }
    } catch (e) {
      setApplyMsg(`오류: ${String(e)}`);
    } finally {
      setApplying(false);
    }
  }, [selected, diagnostics]);

  const handleRestoreBackup = useCallback(async () => {
    if (!lastBackup) return;

    setApplying(true);
    setApplyMsg(null);
    try {
      await invoke("restore_backup", {
        backupPath: lastBackup.path,
        provider: lastBackup.provider,
      });

      const restored = lastBackup.provider === "gemini"
        ? await invoke<string>("read_gemini_md").catch(() => "")
        : lastBackup.provider === "codex"
        ? await invoke<string>("read_codex_md").catch(() => "")
        : await invoke<string>("read_claude_md").catch(() => "");

      if (lastBackup.provider === "gemini") setGeminiMd(restored);
      else if (lastBackup.provider === "codex") setCodexMd(restored);
      else setClaudeMd(restored);

      setApplyMsg(`복원 완료. 사용한 백업: ${lastBackup.path}`);
      setLastBackup(null);

      if (selected) {
        const result = await invoke<ReadResult>("read_session", { path: selected.path });
        const parsed = parseSession(result.content, selected.session_id, selected.project, selected.path);
        const diag = analyzeSession(parsed, restored);
        const usageWindow = buildUsageWindowContext(diag, diagnostics);
        setDiagnostic(diag);
        setFixes(prescribe(diag, restored, usageWindow));
      }
    } catch (e) {
      setApplyMsg(`오류: ${String(e)}`);
    } finally {
      setApplying(false);
    }
  }, [lastBackup, selected, diagnostics]);

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="sidebar-header">
          <span>TokenScope</span>
        </div>
        <div className="sidebar-body">
          <SessionList
            sessions={sessions}
            selectedPath={selected?.path ?? null}
            onSelect={handleSelect}
            loading={loadingList}
            error={listError}
            diagnostics={diagnostics}
          />
        </div>
      </aside>

      <main className="main">
        {!selected && (
          <Dashboard diagnostics={diagnostics} />
        )}

        {selected && analyzing && (
          <div className="empty"><span className="spinner" /></div>
        )}

        {selected && !analyzing && diagnostic && (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <button className="btn ghost" onClick={() => setSelected(null)}>← 대시보드로 돌아가기</button>
              <span style={{ fontSize: 11, color: "var(--muted)", maxWidth: "60%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {selected.path}
              </span>
            </div>
            
            <SummaryCard session={diagnostic.session} diagnostic={diagnostic} />
            {applyMsg && (
              <div className="card" style={{ color: applyMsg.startsWith("오류") ? "var(--red)" : "var(--green)", fontSize: 12 }}>
                {applyMsg}
                {lastBackup && !applyMsg.startsWith("오류") && (
                  <div style={{ marginTop: 10 }}>
                    <button className="btn ghost" onClick={handleRestoreBackup} disabled={applying}>
                      {applying ? "복원 중..." : "백업에서 되돌리기"}
                    </button>
                  </div>
                )}
              </div>
            )}

            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              {["summary", "conversation", "coach", "detail", "guide"].map(tab => (
                <button
                  key={tab}
                  className={`btn ${activeTab === tab ? "active" : ""}`}
                  onClick={() => setActiveTab(tab)}
                  style={{
                    flex: 1, padding: "8px 12px", borderRadius: 6, border: "1px solid var(--border)",
                    background: activeTab === tab ? "var(--primary)" : "var(--surface2)",
                    color: activeTab === tab ? "var(--primary-fg)" : "var(--text)",
                  }}
                >
                  {getTabLabel(tab)}
                </button>
              ))}
            </div>

            {activeTab === "summary" && (
              <>
                {fixes.length === 0 && (
                  <div className="card" style={{ textAlign: "center", color: "var(--muted)" }}>
                    발견된 낭비 패턴이 없습니다. 매우 효율적으로 사용하고 계시네요!
                  </div>
                )}
                {fixes.map((fix, i) => (
                  <FixPreview
                    key={i}
                    fix={fix}
                    onApply={() => handleApplyFix(fix)}
                    applying={applying}
                  />
                ))}
              </>
            )}

            {activeTab === "detail" && (
              <div className="card">
                <div className="card-title">세부 진단 항목</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                  <DetailRow label="캐시 적중률" score={diagnostic.scoreBreakdown.cacheEfficiency} desc={diagnostic.scoreBreakdown.explanations.cacheEfficiency} />
                  <DetailRow label="도구 성공률" score={diagnostic.scoreBreakdown.toolSuccessRate} desc={diagnostic.scoreBreakdown.explanations.toolSuccessRate} />
                  <DetailRow label="컨텍스트 밀도" score={diagnostic.scoreBreakdown.contextDensity} desc={diagnostic.scoreBreakdown.explanations.contextDensity} />
                  <DetailRow 
                    label={`${getConfigLabel(diagnostic.session.provider)} 최적화`}
                    score={diagnostic.scoreBreakdown.claudeMdHealth} 
                    desc={diagnostic.scoreBreakdown.explanations.claudeMdHealth} 
                  />
                  <DetailRow label="재시도 억제" score={diagnostic.scoreBreakdown.retryHealth} desc={diagnostic.scoreBreakdown.explanations.retryHealth} />
                  <DetailRow label="세션 집중도" score={diagnostic.scoreBreakdown.actionFocus} desc={diagnostic.scoreBreakdown.explanations.actionFocus} />
                </div>
              </div>
            )}

            {activeTab === "conversation" && (
              <ConversationReview diagnostic={diagnostic} />
            )}

            {activeTab === "coach" && (
              <PromptCoachPanel diagnostic={diagnostic} />
            )}

            {activeTab === "guide" && (
              <QuestionGuide patterns={diagnostic.patterns} scoreBreakdown={diagnostic.scoreBreakdown} />
            )}
          </>
        )}
      </main>
    </div>
  );
}

const DETAIL_TIPS: Record<string, string[]> = {
  "캐시 적중률": ["세션 초반에 필요한 파일을 모두 Read하고 이후엔 변경을 최소화하세요."],
  "도구 성공률": ["설정 파일에 '도구 3회 실패 시 다른 접근법을 시도하라'고 명시하세요."],
  "컨텍스트 밀도": ["출력 형식과 기대 길이를 구체적으로 요청하세요."],
  "CLAUDE.md 최적화": ["항상 필요한 지침은 유지하고, 상황별 긴 절차는 별도 문서나 Skill로 분리하세요."],
  "GEMINI.md 최적화": ["전역 지침에는 핵심 원칙만 두고, 특정 작업 지침은 필요할 때만 읽게 하세요."],
  "AGENTS.md 최적화": ["전역 AGENTS.md는 라우팅 규칙 중심으로 두고, 프로젝트별 상세 지침은 해당 저장소에만 두세요."],
  "Cursor Rules 최적화": ["Cursor 전역 규칙은 짧게 유지하고, 프로젝트별 규칙은 해당 저장소의 .cursor/rules에 두세요."],
  "재시도 억제": ["동일 에러 반복 시 전략을 수정하도록 설정 파일에 명시하세요."],
  "세션 집중도": ["한 세션에는 하나의 목표만 맡기고, 기획/구현/검증은 별도 세션으로 나누세요."],
};

function getConfigMd(provider: string, claudeMd: string, geminiMd: string, codexMd: string): string {
  if (provider === "gemini") return geminiMd;
  if (provider === "codex") return codexMd;
  if (provider === "cursor") return "";
  return claudeMd;
}

function getSessionConfigMd(parsed: ReturnType<typeof parseSession>, claudeMd: string, geminiMd: string, codexMd: string): string {
  return parsed.fixtureConfigMd ?? getConfigMd(parsed.provider, claudeMd, geminiMd, codexMd);
}

function getConfigLabel(provider: string): string {
  if (provider === "gemini") return "GEMINI.md";
  if (provider === "codex") return "AGENTS.md";
  if (provider === "cursor") return "Cursor Rules";
  return "CLAUDE.md";
}

function getTabLabel(tab: string): string {
  if (tab === "summary") return "처방";
  if (tab === "conversation") return "대화 기록";
  if (tab === "coach") return "질문 코치";
  if (tab === "detail") return "상세";
  return "질문 가이드";
}

function buildUsageWindowContext(current: DiagnosticResult, diagnostics: Map<string, DiagnosticResult>): UsageWindowContext {
  const byPath = new Map<string, DiagnosticResult>(diagnostics);
  byPath.set(current.session.filePath, current);

  const anchor = parseSessionTime(current.session.endTime) ?? parseSessionTime(current.session.startTime) ?? Date.now();
  const fiveHoursMs = 5 * 60 * 60 * 1000;
  const windowStart = anchor - fiveHoursMs;
  const window = Array.from(byPath.values()).filter(result => {
    const time = parseSessionTime(result.session.endTime) ?? parseSessionTime(result.session.startTime);
    return time === null ? result.session.filePath === current.session.filePath : time >= windowStart && time <= anchor;
  });
  const fallback = window.length > 0 ? window : [current];

  return {
    fiveHourTotalTokens: fallback.reduce((sum, result) => sum + getSessionTotalTokens(result), 0),
    fiveHourUserTurns: fallback.reduce((sum, result) => sum + result.session.messages.filter(m => m.role === "user" && isHumanVisibleMessage(m)).length, 0),
    analyzedSessionCount: fallback.length,
  };
}

function parseSessionTime(value: string): number | null {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

function getSessionTotalTokens(result: DiagnosticResult): number {
  return result.session.totalInputTokens + result.session.totalOutputTokens + result.session.totalCacheReadTokens;
}

function DetailRow({ label, score, desc }: { label: string; score: number; desc: string }) {
  const color = score > 80 ? "var(--green)" : score > 50 ? "var(--orange)" : "var(--red)";
  const tips = score < 60 ? DETAIL_TIPS[label] : null;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ fontWeight: 600, fontSize: 13 }}>{label}</span>
        <span style={{ fontWeight: 700, color }}>{score}점</span>
      </div>
      <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.4, marginBottom: tips ? 8 : 0 }}>{desc}</div>
      {tips && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 4 }}>
          {tips.map((tip, i) => (
            <div key={i} style={{ fontSize: 11, color: "var(--text)", padding: "6px 10px", background: "var(--surface2)", borderRadius: 4, borderLeft: "2px solid var(--orange)" }}>{tip}</div>
          ))}
        </div>
      )}
    </div>
  );
}
