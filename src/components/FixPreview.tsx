import { Fix } from "../lib/prescriber";
import { DiffViewer } from "./DiffViewer";

interface Props {
  fix: Fix;
  onApply: () => void;
  applying: boolean;
}

function fmt(n: number): string {
  return n.toLocaleString("ko-KR");
}

function fmtPercent(n: number): string {
  return `${n.toLocaleString("ko-KR", { maximumFractionDigits: 1 })}%`;
}

function confidenceLabel(value: "HIGH" | "MEDIUM" | "LOW"): string {
  if (value === "HIGH") return "높음";
  if (value === "MEDIUM") return "중간";
  return "낮음";
}

export function FixPreview({ fix, onApply, applying }: Props) {
  if (fix.action.kind !== "edit_config_md") {
    return (
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="card-title">{fix.title}</div>
        <div style={{ fontSize: 13, color: "var(--text)", marginBottom: 12 }}>
          {fix.description}
        </div>
        <MetaRow fix={fix} />
        <div style={{ fontSize: 12, color: "var(--muted)" }}>
          {fix.action.steps.map((step, i) => (
            <div key={i} style={{ marginBottom: 4 }}>
              {step}
            </div>
          ))}
        </div>
      </div>
    );
  }

  const { beforeAfterComparison } = fix;
  if (!beforeAfterComparison) {
    return (
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="card-title">{fix.title}</div>
        <div style={{ fontSize: 13, color: "var(--text)", marginBottom: 12 }}>
          {fix.description}
        </div>
        <MetaRow fix={fix} />
        <div style={{ marginBottom: 12 }}>
          <DiffViewer diff={fix.action.diff} maxLines={80} />
        </div>
        <button
          className="btn"
          onClick={onApply}
          disabled={applying}
          style={{ width: "100%" }}
        >
          {applying ? "적용 중..." : "적용"}
        </button>
      </div>
    );
  }

  const {
    beforeTokens,
    afterTokens,
    savedTokens,
    savedPercentage,
    savedCostFormatted,
    basis,
    confidence,
    sessionSavedPercentage,
    fiveHourTotalTokens,
    fiveHourSavedPercentage,
    averageUserTurnTokens,
    equivalentUserTurns,
  } = beforeAfterComparison;
  const requiresManualReview = confidence === "LOW" || fix.action.diff.length > 160;
  const manualReason = confidence === "LOW"
    ? "신뢰도 낮음 처방은 자동 적용하지 않습니다. diff를 검토한 뒤 수동으로 반영하세요."
    : "diff가 커서 자동 적용보다 수동 검토를 권장합니다.";

  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div className="card-title">{fix.title}</div>
      <div style={{ fontSize: 13, color: "var(--text)", marginBottom: 12 }}>
        {fix.description}
      </div>
      <MetaRow fix={fix} confidence={confidence} />

      {/* 예상 절약 효과 */}
      <div
        style={{
          background: "var(--surface2)",
          padding: "12px",
          borderRadius: 6,
          marginBottom: 12,
        }}
      >
        <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>
          예상 절약 효과
        </div>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 11, color: "var(--muted)" }}>수정 전</div>
            <div style={{ fontSize: 16, fontWeight: 600, color: "var(--text)" }}>
              {fmt(beforeTokens)} 토큰
            </div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: "var(--muted)" }}>수정 후</div>
            <div style={{ fontSize: 16, fontWeight: 600, color: "var(--green)" }}>
              {fmt(afterTokens)} 토큰
            </div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: "var(--muted)" }}>절약</div>
            <div style={{ fontSize: 16, fontWeight: 600, color: "var(--red)" }}>
              {fmt(savedTokens)} 토큰 ({savedPercentage}%)
            </div>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8, marginTop: 12 }}>
          <ImpactBox label="현재 세션 기준" value={`${fmtPercent(sessionSavedPercentage)} 절약`} />
          <ImpactBox label="최근 5시간 기준" value={`${fmtPercent(fiveHourSavedPercentage ?? 0)} 절약`} />
          <ImpactBox label="평균 요청 환산" value={`약 ${equivalentUserTurns ?? 0}턴`} />
        </div>
        <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 8, lineHeight: 1.5 }}>
          ChatGPT Plus/Claude Pro처럼 시간 단위 한도가 있는 구독제를 체감하기 쉽게, 최근 5시간 분석 사용량 {fmt(fiveHourTotalTokens ?? 0)} 토큰 중 {fmt(savedTokens)} 토큰을 줄이는 시뮬레이션입니다.
          {averageUserTurnTokens ? ` 평균 사용자 요청 ${fmt(averageUserTurnTokens)} 토큰 기준으로 환산했습니다.` : ""}
        </div>
        {savedCostFormatted && (
          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
            비용 절약: {savedCostFormatted}
          </div>
        )}
        <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
          근거: {basis} · 신뢰도 {confidenceLabel(confidence)}
        </div>
      </div>

      {requiresManualReview && (
        <div style={{ background: "rgba(255,170,77,0.12)", border: "1px solid var(--orange)", borderRadius: 6, padding: "10px 12px", marginBottom: 12, fontSize: 12, color: "var(--text)", lineHeight: 1.55 }}>
          {manualReason}
        </div>
      )}

      <div style={{ marginBottom: 12 }}>
        <DiffViewer diff={fix.action.diff} maxLines={80} />
      </div>

      <button
        className="btn"
        onClick={onApply}
        disabled={applying || requiresManualReview}
        style={{ width: "100%" }}
      >
        {applying ? "적용 중..." : requiresManualReview ? "수동 검토 필요" : "적용"}
      </button>
    </div>
  );
}

function MetaRow({ fix, confidence }: { fix: Fix; confidence?: "HIGH" | "MEDIUM" | "LOW" }) {
  const risk = confidence === "LOW" ? "수동 검토" : confidence === "HIGH" ? "낮음" : "중간";
  const target = fix.action.kind === "edit_config_md"
    ? fix.action.provider === "gemini" ? "GEMINI.md" : fix.action.provider === "codex" ? "AGENTS.md" : "CLAUDE.md"
    : "질문 방식";

  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
      <Badge label="목적" value={purposeLabel(fix.patternType)} />
      <Badge label="대상" value={target} />
      <Badge label="위험도" value={risk} />
    </div>
  );
}

function Badge({ label, value }: { label: string; value: string }) {
  return (
    <span style={{ fontSize: 11, color: "var(--muted)", border: "1px solid var(--border)", borderRadius: 999, padding: "4px 8px", background: "var(--surface2)" }}>
      {label}: <strong style={{ color: "var(--text)" }}>{value}</strong>
    </span>
  );
}

function purposeLabel(type: Fix["patternType"]): string {
  switch (type) {
    case "CONTEXT_BLOAT":
      return "상시 지침 비용 감소";
    case "TOOL_THRASH":
      return "반복 실패 중단";
    case "SESSION_SCOPE_DRIFT":
    case "PHASE_MIXING":
      return "세션 분리";
    case "BROAD_REQUEST":
      return "요청 압축";
    case "RETRY_STORM":
      return "재시도 억제";
    default:
      return "낭비 감소";
  }
}

function ImpactBox({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6, padding: "8px 10px", minWidth: 0 }}>
      <div style={{ fontSize: 10, color: "var(--muted)", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 13, color: "var(--text)", fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{value}</div>
    </div>
  );
}
