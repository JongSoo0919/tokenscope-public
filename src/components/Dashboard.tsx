import { useState } from "react";
import { DiagnosticResult } from "../lib/analyzer";

const TIPS = [
  "CLAUDE.md는 매 요청마다 시스템 프롬프트로 주입됩니다. 길수록 매 요청 비용이 그대로 올라갑니다.",
  "캐시 적중률을 높이려면 대화 초반에 필요한 파일을 모두 Read하고, 이후엔 불필요한 컨텍스트 변경을 줄이세요.",
  "같은 도구로 3회 이상 실패하면 접근법을 바꾸도록 CLAUDE.md에 명시하면 도구 실패율을 크게 줄일 수 있습니다.",
  "세션이 길어질수록 입력 토큰이 누적됩니다. 새 작업은 새 세션에서 시작하는 것이 비용 면에서 효율적입니다.",
  "CLAUDE.md는 1,500자 이내로 유지하세요. 불필요한 예시·중복 내용을 제거하면 매 요청마다 토큰이 절약됩니다.",
  "반복적인 재시도는 지침이 불명확하다는 신호입니다. CLAUDE.md에 더 구체적인 단계별 지침을 추가하세요.",
  "cache_creation 비용은 cache_read보다 높습니다. 캐시된 컨텍스트를 여러 번 재활용하는 구조로 작업하세요.",
  "도구 오류가 많다면 입력값 검증 지침을 CLAUDE.md에 추가하는 것이 효과적입니다.",
  "출력 토큰보다 입력 토큰이 훨씬 많다면 컨텍스트가 너무 비대한 신호입니다. 관련 없는 정보를 줄이세요.",
  "CLAUDE.md의 각 섹션을 정기적으로 검토하고 사용하지 않는 지침은 과감히 삭제하세요.",
  "하나의 세션에서 무관한 작업을 섞으면 캐시 효율이 떨어집니다. 주제별로 세션을 분리하세요.",
];

function scoreColor(s: number) {
  return s >= 70 ? "var(--green)" : s >= 40 ? "var(--orange)" : "var(--red)";
}

function Bar({ value, color }: { value: number; color: string }) {
  return (
    <div style={{ flex: 1, background: "var(--surface2)", borderRadius: 4, height: 16, overflow: "hidden" }}>
      <div style={{ width: `${Math.min(100, Math.max(0, value))}%`, height: "100%", background: color, borderRadius: 4, transition: "width 0.5s ease" }} />
    </div>
  );
}

function decodeProjectName(raw: string): string {
  try {
    return decodeURIComponent(raw.replace(/-/g, "/")).split("/").filter(Boolean).pop() ?? raw;
  } catch { return raw; }
}

interface Props {
  diagnostics: Map<string, DiagnosticResult>;
}

export function Dashboard({ diagnostics }: Props) {
  const [tipIdx] = useState(() => Math.floor(Math.random() * TIPS.length));

  const results = Array.from(diagnostics.values()).sort(
    (a, b) => new Date(b.session.startTime).getTime() - new Date(a.session.startTime).getTime()
  );
  const count = results.length;

  if (count === 0) {
    return (
      <div className="empty">
        분석된 세션이 없습니다.<br />
        왼쪽 목록에서 세션을 선택하면 자동으로 분석됩니다.
      </div>
    );
  }

  const avg = (fn: (r: DiagnosticResult) => number) =>
    results.reduce((s, r) => s + fn(r), 0) / count;

  const avgScore  = Math.round(avg(r => r.healthScore));
  const avgCache  = avg(r => r.scoreBreakdown.cacheEfficiency);
  const avgTool   = avg(r => r.scoreBreakdown.toolSuccessRate);
  const avgCtx    = avg(r => r.scoreBreakdown.contextDensity);
  const avgClaude = avg(r => r.scoreBreakdown.claudeMdHealth);
  const avgRetry  = avg(r => r.scoreBreakdown.retryHealth);
  const totalWasted   = results.reduce((s, r) => s + r.totalWastedTokens, 0);
  const criticalCount = results.filter(r => r.healthScore < 40).length;

  // Strengths / weaknesses with detail
  const strengths: { title: string; detail: string }[] = [];
  const weaknesses: { title: string; tip: string }[] = [];

  if (avgCache >= 70) strengths.push({
    title: `캐시 적중률 ${avgCache.toFixed(0)}% — 우수`,
    detail: "컨텍스트를 일관되게 유지해 토큰을 효율적으로 재활용하고 있습니다.",
  });
  else if (avgCache < 45) weaknesses.push({
    title: `캐시 적중률 ${avgCache.toFixed(0)}% — 낮음`,
    tip: "작업 초반에 필요한 파일을 한 번에 로드하고, 한 세션에서 무관한 작업을 섞지 마세요.",
  });

  if (avgTool >= 90) strengths.push({
    title: `도구 성공률 ${avgTool.toFixed(0)}% — 탁월`,
    detail: "도구 호출이 거의 실패 없이 정확하게 실행되고 있습니다.",
  });
  else if (avgTool < 70) weaknesses.push({
    title: `도구 실패율 ${(100 - avgTool).toFixed(0)}% — 높음`,
    tip: "CLAUDE.md에 도구 3회 실패 시 대안 전략을 명시하고, 절대경로 사용을 지침에 추가하세요.",
  });

  if (avgClaude >= 80) strengths.push({
    title: "CLAUDE.md 경량 — 양호",
    detail: "CLAUDE.md가 간결하게 관리되어 매 요청 오버헤드가 낮습니다.",
  });
  else if (avgClaude < 50) {
    const estimatedTokens = Math.round((1 - avgClaude / 100) * 3000);
    weaknesses.push({
      title: `CLAUDE.md 약 ${estimatedTokens}+ 토큰 — 과부하`,
      tip: "사용하지 않는 섹션을 삭제하고 긴 예시를 원칙으로 압축하세요. 목표: 1,500자 이내.",
    });
  }

  if (avgRetry >= 90) strengths.push({
    title: "반복 요청 없음 — 효율적",
    detail: "불필요한 재시도나 반복 요청이 거의 발생하지 않고 있습니다.",
  });
  else if (avgRetry < 60) weaknesses.push({
    title: "반복 재시도 다수 감지",
    tip: "CLAUDE.md에 명확한 단계별 지침을 추가하고, 실패 시 다른 접근법을 시도하도록 명시하세요.",
  });

  if (avgCtx >= 70) strengths.push({
    title: "컨텍스트 대비 출력 효율 좋음",
    detail: "입력 토큰 대비 출력이 충분해 비용 대비 가치가 높습니다.",
  });
  else if (avgCtx < 35) weaknesses.push({
    title: "컨텍스트 밀도 낮음",
    tip: "구체적인 출력 형식과 기대 길이를 요청에 명시하면 같은 비용으로 더 많은 정보를 얻을 수 있습니다.",
  });

  const chartData = results.slice(0, 10).reverse();

  return (
    <div>
      {/* 통계 헤더 */}
      <div className="stat-grid" style={{ marginBottom: 16 }}>
        <div className="stat-box">
          <div className="stat-label">평균 건강 점수</div>
          <div className={`stat-value ${avgScore >= 70 ? "green" : avgScore >= 40 ? "orange" : "red"}`}>{avgScore}점</div>
        </div>
        <div className="stat-box">
          <div className="stat-label">분석 세션 수</div>
          <div className="stat-value blue">{count}개</div>
        </div>
        <div className="stat-box">
          <div className="stat-label">낭비 토큰 (추정)</div>
          <div className="stat-value orange">{totalWasted.toLocaleString()}</div>
        </div>
        <div className="stat-box">
          <div className="stat-label">주의 필요 세션</div>
          <div className="stat-value red">{criticalCount}개</div>
        </div>
      </div>

      {/* 건강 점수 차트 */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title">세션별 건강 점수 (최근 {chartData.length}개)</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
          {chartData.map((r, i) => {
            const color = scoreColor(r.healthScore);
            return (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 108, fontSize: 11, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "right", flexShrink: 0 }}>
                  {decodeProjectName(r.session.project)}
                </div>
                <Bar value={r.healthScore} color={color} />
                <div style={{ width: 32, fontSize: 12, fontWeight: 700, color, textAlign: "right", flexShrink: 0 }}>
                  {r.healthScore}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 평균 지표 차트 */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title">평균 지표 분석 (전체 세션 기준)</div>
        {[
          { label: "캐시 효율",     value: avgCache },
          { label: "도구 성공률",   value: avgTool },
          { label: "컨텍스트 밀도", value: avgCtx },
          { label: "CLAUDE.md",    value: avgClaude },
          { label: "반복 억제",     value: avgRetry },
        ].map((m, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: i < 4 ? 9 : 0 }}>
            <div style={{ width: 96, fontSize: 11, color: "var(--muted)", flexShrink: 0 }}>{m.label}</div>
            <Bar value={m.value} color={scoreColor(m.value)} />
            <div style={{ width: 32, fontSize: 12, fontWeight: 700, color: scoreColor(m.value), textAlign: "right", flexShrink: 0 }}>
              {Math.round(m.value)}
            </div>
          </div>
        ))}
      </div>

      {/* 랜덤 팁 */}
      <div style={{
        background: "var(--surface)",
        border: "1px solid var(--accent)",
        borderRadius: 8,
        padding: "12px 16px",
        marginBottom: 16,
        fontSize: 13,
        lineHeight: 1.65,
      }}>
        <span style={{ color: "var(--accent)", fontWeight: 700, marginRight: 8 }}>💡 오늘의 절약 팁</span>
        <span style={{ color: "var(--text)" }}>{TIPS[tipIdx]}</span>
      </div>

      {/* 잘하고 있는 점 / 개선 필요 */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title">프롬프팅 평가</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--green)", marginBottom: 10 }}>잘하고 있는 점</div>
            {strengths.length === 0 ? (
              <div style={{ fontSize: 12, color: "var(--muted)" }}>세션을 더 분석하면 평가가 채워집니다</div>
            ) : strengths.map((s, i) => (
              <div key={i} style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 12, color: "var(--green)", fontWeight: 600 }}>✓ {s.title}</div>
                <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 3, lineHeight: 1.5 }}>{s.detail}</div>
              </div>
            ))}
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--orange)", marginBottom: 10 }}>개선이 필요한 점</div>
            {weaknesses.length === 0 ? (
              <div style={{ fontSize: 12, color: "var(--green)" }}>모든 주요 지표가 양호합니다!</div>
            ) : weaknesses.map((w, i) => (
              <div key={i} style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 12, color: "var(--orange)", fontWeight: 600 }}>✗ {w.title}</div>
                <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 3, lineHeight: 1.5 }}>
                  <strong style={{ color: "var(--accent)" }}>개선 팁:</strong> {w.tip}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 최근 세션 목록 */}
      <div className="card">
        <div className="card-title">최근 분석 세션</div>
        {results.slice(0, 8).map((r, i) => (
          <div key={i} style={{
            display: "flex", alignItems: "center", gap: 12,
            padding: "9px 0",
            borderBottom: i < Math.min(7, results.length - 1) ? "1px solid var(--border)" : "none",
          }}>
            <div style={{ flex: 1, overflow: "hidden" }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", marginBottom: 2 }}>
                {decodeProjectName(r.session.project)}
              </div>
              <div style={{ fontSize: 11, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {r.sessionSummary}
              </div>
            </div>
            <div style={{ fontSize: 13, fontWeight: 700, color: scoreColor(r.healthScore), flexShrink: 0 }}>
              {r.healthScore}점
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
