import { Fix } from "../lib/prescriber";

interface Props {
  fix: Fix;
  onApply: () => void;
  applying: boolean;
}

function fmt(n: number): string {
  return n.toLocaleString("ko-KR");
}

export function FixPreview({ fix, onApply, applying }: Props) {
  if (fix.action.kind !== "edit_config_md") {
    return (
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="card-title">{fix.title}</div>
        <div style={{ fontSize: 13, color: "var(--text)", marginBottom: 12 }}>
          {fix.description}
        </div>
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

  const { beforeTokens, afterTokens, savedTokens, savedPercentage, savedCostFormatted } = beforeAfterComparison;

  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div className="card-title">{fix.title}</div>
      <div style={{ fontSize: 13, color: "var(--text)", marginBottom: 12 }}>
        {fix.description}
      </div>

      {/* 수정 전/후 토큰 비교 */}
      <div
        style={{
          background: "var(--surface2)",
          padding: "12px",
          borderRadius: 6,
          marginBottom: 12,
        }}
      >
        <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>
          수정 전/후 토큰 비교
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
        <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 8 }}>
          이 수정을 적용하면 세션당 약 {fmt(savedTokens)} 토큰 절약 예상
        </div>
        {savedCostFormatted && (
          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
            비용 절약: {savedCostFormatted}
          </div>
        )}
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
