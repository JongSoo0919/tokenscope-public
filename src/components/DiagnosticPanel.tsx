import { DiagnosticResult, isContextBloatEvidence, isToolThrashEvidence } from "../lib/analyzer";
import { Fix, isEditConfigMdAction, isInfoAction } from "../lib/prescriber";
import { DiffViewer } from "./DiffViewer";

interface Props {
  diagnostic: DiagnosticResult;
  fixes: Fix[];
  onApplyFix: (fix: Fix) => void;
  applying: boolean;
}

export function DiagnosticPanel({ diagnostic, fixes, onApplyFix, applying }: Props) {
  if (diagnostic.patterns.length === 0) {
    return (
      <div className="card">
        <div className="card-title">진단 결과</div>
        <div className="empty" style={{ padding: "24px 0" }}>
          낭비 패턴이 감지되지 않았습니다.
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-title">감지된 낭비 패턴 ({diagnostic.patterns.length}개)</div>
      {diagnostic.patterns.map((pattern, i) => {
        const fix = fixes.find(f => f.patternType === pattern.type);
        const evidence = pattern.evidence;

        return (
          <div key={i} className={`pattern-item ${pattern.severity}`}>
            <div className="pattern-header">
              <span className="pattern-title">{pattern.title}</span>
              <span className={`badge ${pattern.severity}`}>{pattern.severity}</span>
            </div>
            <div className="pattern-desc">{pattern.description}</div>
            <div className="pattern-tokens">
              낭비 추정: ~{pattern.estimatedWastedTokens.toLocaleString()} 토큰
            </div>

            {isContextBloatEvidence(evidence) && (
              <div className="offender-list">
                {evidence.topOffenders.map((s, j) => (
                  <div key={j} className="offender-item">
                    <span className="offender-name">## {s.heading}</span>
                    <span className="offender-tokens">~{s.estimatedTokens.toLocaleString()} 토큰</span>
                  </div>
                ))}
              </div>
            )}

            {isToolThrashEvidence(evidence) && (
              <div className="pattern-desc" style={{ marginTop: 6 }}>
                연속 실패 횟수: {evidence.consecutiveErrors}회
              </div>
            )}

            {fix && (
              <div className="steps">
                {isInfoAction(fix.action) && fix.action.steps.map((step, j) => (
                  <div key={j} className="step">{step}</div>
                ))}
                {isEditConfigMdAction(fix.action) && (
                  <>
                    <div style={{ marginTop: 10, marginBottom: 6, fontSize: 12, color: "var(--muted)" }}>
                      제안된 {fix.action.provider === "gemini" ? "GEMINI.md" : fix.action.provider === "codex" ? "AGENTS.md" : "CLAUDE.md"} 변경사항:
                    </div>
                    <DiffViewer diff={fix.action.diff} maxLines={40} />
                    <div className="btn-row">
                      <button
                        className="btn primary"
                        disabled={applying}
                        onClick={() => onApplyFix(fix)}
                      >
                        {applying ? "적용 중…" : "변경사항 적용"}
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
