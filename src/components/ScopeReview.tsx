import {
  DiagnosticResult,
  isPhaseMixingEvidence,
  isSessionScopeEvidence,
} from "../lib/analyzer";

interface Props {
  diagnostic: DiagnosticResult;
}

export function ScopeReview({ diagnostic }: Props) {
  const scopePattern = diagnostic.patterns.find(pattern => isSessionScopeEvidence(pattern.evidence));
  const phasePattern = diagnostic.patterns.find(pattern => isPhaseMixingEvidence(pattern.evidence));
  const actionFocus = diagnostic.scoreBreakdown.actionFocus;
  const color = actionFocus >= 85 ? "var(--green)" : actionFocus >= 60 ? "var(--orange)" : "var(--red)";

  return (
    <div className="card">
      <div className="card-title">스코프</div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(160px, 220px) 1fr", gap: 16, alignItems: "start" }}>
        <div style={{ background: "var(--surface2)", borderRadius: 6, padding: 14, textAlign: "center" }}>
          <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>세션 집중도</div>
          <div style={{ fontSize: 34, fontWeight: 800, color }}>{actionFocus}</div>
          <div style={{ fontSize: 11, color: "var(--muted)" }}>/ 100</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <ScopeCard
            title="범위 판단"
            tone={scopePattern ? scopePattern.severity : "LOW"}
            body={scopePattern ? scopePattern.description : "한 세션 안에서 큰 작업 범위 혼합은 감지되지 않았습니다."}
          />

          {scopePattern && isSessionScopeEvidence(scopePattern.evidence) && (
            <ScopeCard
              title="감지된 작업 흐름"
              tone={scopePattern.severity}
              body={`${scopePattern.evidence.detectedWorkTypes.join(", ")} · 사용자 요청 ${scopePattern.evidence.userTurns}턴`}
              footer={scopePattern.evidence.recommendation}
            />
          )}

          {phasePattern && isPhaseMixingEvidence(phasePattern.evidence) && (
            <ScopeCard
              title="단계 혼합"
              tone={phasePattern.severity}
              body={`${phasePattern.evidence.phases.join(", ")} 단계가 같은 세션에 포함되었습니다.`}
              footer={phasePattern.evidence.recommendation}
            />
          )}

          <ScopeCard
            title="해석"
            tone={actionFocus >= 85 ? "LOW" : actionFocus >= 60 ? "MEDIUM" : "HIGH"}
            body={diagnostic.scoreBreakdown.explanations.actionFocus}
          />
        </div>
      </div>
    </div>
  );
}

function ScopeCard({
  title,
  body,
  footer,
  tone,
}: {
  title: string;
  body: string;
  footer?: string;
  tone: "HIGH" | "MEDIUM" | "LOW";
}) {
  const color = tone === "HIGH" ? "var(--red)" : tone === "MEDIUM" ? "var(--orange)" : "var(--green)";

  return (
    <div style={{ borderLeft: `3px solid ${color}`, background: "var(--surface2)", borderRadius: 6, padding: 12 }}>
      <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 5 }}>{title}</div>
      <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.55 }}>{body}</div>
      {footer && (
        <div style={{ fontSize: 11, color: "var(--text)", lineHeight: 1.45, marginTop: 7 }}>
          권장: {footer}
        </div>
      )}
    </div>
  );
}
