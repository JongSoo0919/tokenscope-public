import { useEffect, useState, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { SessionList } from "./components/SessionList";
import { SummaryCard } from "./components/SummaryCard";
import { FixPreview } from "./components/FixPreview";
import { QuestionGuide } from "./components/QuestionGuide";
import { Dashboard } from "./components/Dashboard";
import { parseSession } from "./lib/parser";
import { analyzeSession, DiagnosticResult } from "./lib/analyzer";
import { prescribe, Fix } from "./lib/prescriber";
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
  const [analyzing, setAnalyzing] = useState(false);
  const [activeTab, setActiveTab] = useState("summary");

  const [applying, setApplying] = useState(false);
  const [applyMsg, setApplyMsg] = useState<string | null>(null);

  const initialLoadDone = useRef(false);

  useEffect(() => {
    const init = async () => {
      try {
        const sessionList = await invoke<SessionFile[]>("list_sessions");
        setSessions(sessionList);
        setLoadingList(false);

        const cMd = await invoke<string>("read_claude_md").catch(() => "");
        const gMd = await invoke<string>("read_gemini_md").catch(() => "");
        setClaudeMd(cMd);
        setGeminiMd(gMd);

        if (!initialLoadDone.current && sessionList.length > 0) {
          initialLoadDone.current = true;
          const recent = sessionList.slice(0, 15); // 분석 범위를 조금 더 확장
          const results = new Map<string, DiagnosticResult>();
          
          for (const s of recent) {
            try {
              const res = await invoke<ReadResult>("read_session", { path: s.path });
              const parsed = parseSession(res.content, s.session_id, s.project, s.path);
              const configMd = parsed.provider === "gemini" ? gMd : cMd;
              const diag = analyzeSession(parsed, configMd);
              results.set(s.path, diag);
            } catch (e) {
              console.warn(`Initial analysis failed for ${s.path}`, e);
            }
          }
          setDiagnostics(results);
        }
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
    setAnalyzing(true);

    try {
      const result = await invoke<ReadResult>("read_session", { path: session.path });
      // use parseSession for both .json and .jsonl
      const parsed = parseSession(result.content, session.session_id, session.project, session.path);
      const currentConfigMd = parsed.provider === "gemini" ? geminiMd : claudeMd;
      
      const diag = analyzeSession(parsed, currentConfigMd);
      const fixList = prescribe(diag, currentConfigMd);
      
      setDiagnostic(diag);
      setFixes(fixList);
      setDiagnostics(prev => new Map(prev).set(session.path, diag));
    } catch (e) {
      console.error("Selection analysis failed", e);
      setListError(`세션 분석 실패: ${String(e)}`);
    } finally {
      setAnalyzing(false);
    }
  }, [claudeMd, geminiMd]);

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
      else setClaudeMd(suggestedContent);

      setApplyMsg(`저장 완료. 백업: ${backupPath}`);
      
      // Re-analyze
      if (selected) {
        const result = await invoke<ReadResult>("read_session", { path: selected.path });
        const parsed = parseSession(result.content, selected.session_id, selected.project, selected.path);
        const diag = analyzeSession(parsed, suggestedContent);
        setDiagnostic(diag);
        setFixes(prescribe(diag, suggestedContent));
      }
    } catch (e) {
      setApplyMsg(`오류: ${String(e)}`);
    } finally {
      setApplying(false);
    }
  }, [selected]);

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
              </div>
            )}

            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              {["summary", "detail", "guide"].map(tab => (
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
                  {tab === "summary" ? "처방" : tab === "detail" ? "상세" : "질문 가이드"}
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
                    label={diagnostic.session.provider === "gemini" ? "GEMINI.md 최적화" : "CLAUDE.md 최적화"} 
                    score={diagnostic.scoreBreakdown.claudeMdHealth} 
                    desc={diagnostic.scoreBreakdown.explanations.claudeMdHealth} 
                  />
                  <DetailRow label="재시도 억제" score={diagnostic.scoreBreakdown.retryHealth} desc={diagnostic.scoreBreakdown.explanations.retryHealth} />
                </div>
              </div>
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
  "CLAUDE.md 최적화": ["CLAUDE.md를 1,500자 이내로 유지하고 원칙만 간결하게 서술하세요."],
  "GEMINI.md 최적화": ["GEMINI.md의 불필요한 전역 지침을 줄이고 최신 규칙만 유지하세요."],
  "재시도 억제": ["동일 에러 반복 시 전략을 수정하도록 설정 파일에 명시하세요."],
};

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
