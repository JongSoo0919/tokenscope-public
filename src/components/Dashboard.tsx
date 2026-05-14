import { useState } from "react";
import { DiagnosticResult } from "../lib/analyzer";

const TIPS = [
  "전역 CLAUDE.md/AGENTS.md는 없애는 대상이 아니라 모든 프로젝트에 항상 필요한 규칙만 남기는 대상입니다.",
  "캐시 적중률을 높이려면 대화 초반에 필요한 파일을 모두 Read하고, 이후엔 불필요한 컨텍스트 변경을 줄이세요.",
  "같은 도구로 3회 이상 실패하는 문제는 전역 설정보다 해당 프로젝트 AGENTS.md의 실행 규칙으로 남기는 편이 낫습니다.",
  "세션이 길어질수록 입력 토큰이 누적됩니다. 새 작업은 새 세션에서 시작하는 것이 비용 면에서 효율적입니다.",
  "긴 설정 파일은 필수 지침, 자주 쓰는 지침, 상황별 지침으로 나누면 체감 사용량을 줄일 수 있습니다.",
  "반복적인 재시도는 작업 규칙이 불명확하다는 신호입니다. 해당 프로젝트 AGENTS.md에 중단 기준을 짧게 추가하세요.",
  "cache_creation 비용은 cache_read보다 높습니다. 캐시된 컨텍스트를 여러 번 재활용하는 구조로 작업하세요.",
  "도구 오류가 많다면 입력값 검증 지침을 설정 파일에 추가하는 것이 효과적입니다.",
  "출력 토큰보다 입력 토큰이 훨씬 많다면 컨텍스트가 너무 비대한 신호입니다. 관련 없는 정보를 줄이세요.",
  "설정 파일의 각 섹션을 정기적으로 검토하고, 사용 빈도가 낮은 지침은 삭제보다 온디맨드 문서로 분리하세요.",
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

function PieChart({ segments }: { segments: { label: string; value: number; color: string }[] }) {
  const total = Math.max(1, segments.reduce((sum, s) => sum + s.value, 0));
  let cursor = 0;
  const gradient = segments.map(segment => {
    const start = cursor;
    const end = cursor + (segment.value / total) * 100;
    cursor = end;
    return `${segment.color} ${start}% ${end}%`;
  }).join(", ");

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
      <div style={{
        width: 132,
        height: 132,
        borderRadius: "50%",
        background: `conic-gradient(${gradient})`,
        border: "1px solid var(--border)",
        flexShrink: 0,
      }} />
      <div style={{ display: "flex", flexDirection: "column", gap: 7, minWidth: 0 }}>
        {segments.map((s, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
            <span style={{ width: 9, height: 9, borderRadius: 2, background: s.color, flexShrink: 0 }} />
            <span style={{ color: "var(--text)" }}>{s.label}</span>
            <span style={{ color: "var(--muted)" }}>{s.value}개</span>
          </div>
        ))}
      </div>
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

interface WasteCandidate {
  title: string;
  detail: string;
  tokens: number;
  severity: string;
}

interface SubscriptionBudget {
  name: string;
  family: "openai" | "claude";
  estimatedBudget: number;
  usedTokens: number | null;
  optimizedTokens: number | null;
  sessionCount: number;
  basis: string;
  note: string;
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

  const latestTime = Math.max(...results.map(r => getSessionTime(r)).filter(Number.isFinite));
  const windowStart = Number.isFinite(latestTime) ? latestTime - 5 * 60 * 60 * 1000 : 0;
  const recentResults = results.filter(r => {
    const t = getSessionTime(r);
    return Number.isFinite(latestTime) && Number.isFinite(t) ? t >= windowStart && t <= latestTime : false;
  });
  const fiveHourResults = recentResults.length > 0 ? recentResults : results.slice(0, 5);
  const fiveHourCount = fiveHourResults.length;
  const recentAvg = Math.round(fiveHourResults.reduce((s, r) => s + r.healthScore, 0) / Math.max(1, fiveHourCount));
  const recentTool = fiveHourResults.reduce((s, r) => s + r.scoreBreakdown.toolSuccessRate, 0) / Math.max(1, fiveHourCount);
  const recentRetry = fiveHourResults.reduce((s, r) => s + r.scoreBreakdown.retryHealth, 0) / Math.max(1, fiveHourCount);
  const recentAction = fiveHourResults.reduce((s, r) => s + r.scoreBreakdown.actionFocus, 0) / Math.max(1, fiveHourCount);
  const recentConfig = fiveHourResults.reduce((s, r) => s + r.scoreBreakdown.claudeMdHealth, 0) / Math.max(1, fiveHourCount);
  const recentRiskCount = fiveHourResults.filter(r => r.healthScore < 40).length;
  const verdict = buildVerdict(recentAvg, recentRiskCount, recentTool, recentRetry, recentAction);
  const verdictReasons = buildVerdictReasons(fiveHourResults, recentTool, recentRetry, recentAction, recentConfig);
  const topWaste = buildTopWaste(fiveHourResults);
  const recentTokens = fiveHourResults.reduce((sum, result) => sum + getTotalTokens(result), 0);
  const recentWasted = fiveHourResults.reduce((sum, result) => sum + result.totalWastedTokens, 0);
  const subscriptionBudgets = buildSubscriptionBudgets(fiveHourResults);
  const primaryAction = buildPrimaryAction(topWaste[0], recentTool, recentRetry, recentAction, recentConfig);
  const blockAction = buildBlockAction(recentTokens, recentAvg, recentAction);

  const avgScore  = Math.round(avg(r => r.healthScore));
  const avgCache  = avg(r => r.scoreBreakdown.cacheEfficiency);
  const avgTool   = avg(r => r.scoreBreakdown.toolSuccessRate);
  const avgCtx    = avg(r => r.scoreBreakdown.contextDensity);
  const avgClaude = avg(r => r.scoreBreakdown.claudeMdHealth);
  const avgRetry  = avg(r => r.scoreBreakdown.retryHealth);
  const avgAction = avg(r => r.scoreBreakdown.actionFocus);
  const totalWasted   = results.reduce((s, r) => s + r.totalWastedTokens, 0);
  const criticalCount = results.filter(r => r.healthScore < 40).length;
  const providerSegments = ["claude", "gemini", "codex"].map((provider, i) => ({
    label: provider,
    value: results.filter(r => r.session.provider === provider).length,
    color: ["var(--accent)", "var(--green)", "var(--orange)"][i],
  })).filter(s => s.value > 0);
  const healthSegments = [
    { label: "양호", value: results.filter(r => r.healthScore >= 70).length, color: "var(--green)" },
    { label: "주의", value: results.filter(r => r.healthScore >= 40 && r.healthScore < 70).length, color: "var(--orange)" },
    { label: "위험", value: results.filter(r => r.healthScore < 40).length, color: "var(--red)" },
  ].filter(s => s.value > 0);

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
    tip: "설정 파일에 도구 3회 실패 시 대안 전략을 명시하고, 절대경로 사용을 지침에 추가하세요.",
  });

  if (avgClaude >= 80) strengths.push({
    title: "설정 파일 상시 비용 — 낮음",
    detail: "항상 읽히는 지침이 간결하게 관리되어 매 요청 오버헤드가 낮습니다.",
  });
  else if (avgClaude < 50) {
    const estimatedTokens = Math.round((1 - avgClaude / 100) * 3000);
    weaknesses.push({
      title: `설정 파일 약 ${estimatedTokens}+ 토큰 — 상시 비용 큼`,
      tip: "필수 지침은 유지하고, 특정 상황에서만 필요한 긴 예시와 절차는 별도 Skill/문서로 분리하세요.",
    });
  }

  if (avgRetry >= 90) strengths.push({
    title: "반복 요청 없음 — 효율적",
    detail: "불필요한 재시도나 반복 요청이 거의 발생하지 않고 있습니다.",
  });
  else if (avgRetry < 60) weaknesses.push({
    title: "반복 재시도 다수 감지",
    tip: "설정 파일에 명확한 단계별 지침을 추가하고, 실패 시 다른 접근법을 시도하도록 명시하세요.",
  });

  if (avgCtx >= 70) strengths.push({
    title: "컨텍스트 대비 출력 효율 좋음",
    detail: "입력 토큰 대비 출력이 충분해 비용 대비 가치가 높습니다.",
  });
  else if (avgCtx < 35) weaknesses.push({
    title: "컨텍스트 밀도 낮음",
    tip: "구체적인 출력 형식과 기대 길이를 요청에 명시하면 같은 비용으로 더 많은 정보를 얻을 수 있습니다.",
  });

  if (avgAction >= 85) strengths.push({
    title: "세션 집중도 양호",
    detail: "대부분의 세션이 하나의 작업 흐름 안에서 끝나고 있습니다.",
  });
  else if (avgAction < 70) weaknesses.push({
    title: "세션 범위 혼합 감지",
    tip: "기획, 구현, 검증을 같은 세션에서 이어가지 말고 단계별 새 세션으로 분리하세요.",
  });

  const chartData = results.slice(0, 10).reverse();

  return (
    <div>
      <div className="card" style={{ marginBottom: 16, borderColor: verdict.color }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
          <div style={{ minWidth: 260, flex: 1 }}>
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>최근 5시간 기준</div>
            <div style={{ fontSize: 26, fontWeight: 800, color: verdict.color, lineHeight: 1.2 }}>
              {verdict.label}
            </div>
            <div style={{ fontSize: 13, color: "var(--text)", lineHeight: 1.6, marginTop: 8 }}>
              {verdict.message}
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(100px, 1fr))", gap: 8, minWidth: 320 }}>
            <MiniStat label="평균 건강 점수" value={`${recentAvg}점`} color={scoreColor(recentAvg)} />
            <MiniStat label="분석 세션" value={`${fiveHourCount}개`} color="var(--accent)" />
            <MiniStat label="위험 세션" value={`${recentRiskCount}개`} color={recentRiskCount > 0 ? "var(--red)" : "var(--green)"} />
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 16 }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text)", marginBottom: 8 }}>주의 근거</div>
            {verdictReasons.map((reason, i) => (
              <div key={i} style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.55, marginBottom: 5 }}>
                - {reason}
              </div>
            ))}
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text)", marginBottom: 8 }}>가장 큰 낭비 3개</div>
            {topWaste.length === 0 ? (
              <div style={{ fontSize: 12, color: "var(--green)" }}>최근 범위에서 큰 낭비 패턴이 없습니다.</div>
            ) : topWaste.map((item, i) => (
              <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start", marginBottom: 8 }}>
                <div style={{ width: 18, height: 18, borderRadius: 9, background: "var(--surface2)", color: "var(--muted)", fontSize: 11, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{i + 1}</div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12, color: "var(--text)", fontWeight: 700 }}>{item.title}</div>
                  <div style={{ fontSize: 11, color: "var(--muted)", lineHeight: 1.45 }}>
                    {item.detail} · 약 {item.tokens.toLocaleString("ko-KR")} 토큰
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 14 }}>
          <ActionBox title="바로 할 수 있는 액션" body={primaryAction} accent="var(--accent)" />
          <ActionBox title="5시간 블록 행동 추천" body={blockAction} accent={recentTokens > 120000 ? "var(--orange)" : "var(--green)"} />
        </div>
      </div>

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
          <div className="stat-label">절약 후보 토큰</div>
          <div className="stat-value orange">{totalWasted.toLocaleString()}</div>
        </div>
        <div className="stat-box">
          <div className="stat-label">주의 필요 세션</div>
          <div className="stat-value red">{criticalCount}개</div>
        </div>
      </div>

      {/* 건강 점수 차트 */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
        <div className="card" style={{ marginBottom: 0 }}>
          <div className="card-title">공급자 분포</div>
          <PieChart segments={providerSegments} />
        </div>
        <div className="card" style={{ marginBottom: 0 }}>
          <div className="card-title">건강 등급 분포</div>
          <PieChart segments={healthSegments} />
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title">구독제별 추정 토큰 예산</div>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", flexWrap: "wrap", marginBottom: 12 }}>
          <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.55, maxWidth: 680 }}>
            공식 플랜은 고정 토큰량을 공개하지 않고 사용량 배수와 시간창 제한으로 운영됩니다. 아래 값은 최근 5시간 사용량을 공급자별로 분리해 환산한 작업 예산 추정치입니다.
          </div>
          <div style={{ fontSize: 11, color: "var(--muted)", textAlign: "right" }}>
            절약 후보 반영 시<br />
            <strong style={{ color: "var(--green)", fontSize: 13 }}>
              약 {Math.max(0, recentTokens - recentWasted).toLocaleString("ko-KR")} 토큰
            </strong>
          </div>
        </div>
        <div className="plan-budget-grid">
          {subscriptionBudgets.map(plan => (
            <PlanBudgetCard key={plan.name} plan={plan} />
          ))}
        </div>
        <div style={{ fontSize: 11, color: "var(--muted)", lineHeight: 1.5, marginTop: 10 }}>
          출처 기준: OpenAI는 Pro를 Plus 대비 5x/20x 사용량으로 설명하고, Anthropic은 Claude Max를 Pro 대비 5x/20x 사용량으로 설명합니다. 실제 한도는 모델, 피크 시간, 기능, 대화 길이에 따라 달라집니다.
        </div>
      </div>

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
          { label: "설정 파일",    value: avgClaude },
          { label: "반복 억제",     value: avgRetry },
          { label: "세션 집중도",   value: avgAction },
        ].map((m, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: i < 5 ? 9 : 0 }}>
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
        <span style={{ color: "var(--accent)", fontWeight: 700, marginRight: 8 }}>오늘의 절약 팁</span>
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

function MiniStat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 6, padding: "10px 12px" }}>
      <div style={{ fontSize: 10, color: "var(--muted)", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 17, fontWeight: 800, color }}>{value}</div>
    </div>
  );
}

function ActionBox({ title, body, accent }: { title: string; body: string; accent: string }) {
  return (
    <div style={{ background: "var(--surface2)", border: `1px solid ${accent}`, borderRadius: 6, padding: "10px 12px", minWidth: 0 }}>
      <div style={{ fontSize: 10, color: accent, fontWeight: 800, marginBottom: 5 }}>{title}</div>
      <div style={{ fontSize: 12, color: "var(--text)", lineHeight: 1.55 }}>{body}</div>
    </div>
  );
}

function PlanBudgetCard({ plan }: { plan: SubscriptionBudget }) {
  const hasData = plan.usedTokens !== null && plan.optimizedTokens !== null;
  const usedTokens = plan.usedTokens ?? 0;
  const optimizedTokens = plan.optimizedTokens ?? 0;
  const usedPct = hasData && plan.estimatedBudget > 0 ? Math.min(100, Math.round((usedTokens / plan.estimatedBudget) * 100)) : 0;
  const optimizedPct = hasData && plan.estimatedBudget > 0 ? Math.min(100, Math.round((optimizedTokens / plan.estimatedBudget) * 100)) : 0;
  const remaining = hasData ? Math.max(0, plan.estimatedBudget - usedTokens) : null;
  const optimizedRemaining = hasData ? Math.max(0, plan.estimatedBudget - optimizedTokens) : null;
  const color = usedPct >= 90 ? "var(--red)" : usedPct >= 70 ? "var(--orange)" : "var(--green)";

  return (
    <div className="plan-budget-card">
      <div className="plan-budget-top">
        <div>
          <div className="plan-budget-name">{plan.name}</div>
          <div className="plan-budget-basis">{plan.basis}</div>
        </div>
        <div className={`plan-budget-family ${plan.family}`}>{plan.family === "openai" ? "OpenAI" : "Claude"}</div>
      </div>
      <div className="plan-budget-total">
        <span>추정 5시간 총량</span>
        <strong>{plan.estimatedBudget.toLocaleString("ko-KR")}</strong>
        <em>{hasData ? `${usedTokens.toLocaleString("ko-KR")} 사용 + ${remaining?.toLocaleString("ko-KR")} 남음` : "해당 공급자 사용 데이터 없음"}</em>
      </div>
      <div className="plan-budget-main">
        <div>
          <span>5시간 사용</span>
          <strong>{hasData ? usedTokens.toLocaleString("ko-KR") : "-"}</strong>
        </div>
        <div>
          <span>사용률</span>
          <strong style={{ color: hasData ? color : "var(--muted)" }}>{hasData ? `${usedPct}%` : "데이터 없음"}</strong>
        </div>
        <div>
          <span>남은 추정</span>
          <strong>{remaining === null ? "-" : remaining.toLocaleString("ko-KR")}</strong>
        </div>
        <div>
          <span>최적화 후 사용</span>
          <strong>{hasData ? optimizedTokens.toLocaleString("ko-KR") : "-"}</strong>
        </div>
        <div>
          <span>최적화 후 사용률</span>
          <strong>{hasData ? `${optimizedPct}%` : "-"}</strong>
        </div>
        <div>
          <span>최적화 후 남음</span>
          <strong>{optimizedRemaining === null ? "-" : optimizedRemaining.toLocaleString("ko-KR")}</strong>
        </div>
      </div>
      <div className="plan-budget-bars">
        <div className="plan-budget-bar">
          <div style={{ width: `${usedPct}%`, background: color }} />
        </div>
        <div className="plan-budget-bar optimized">
          <div style={{ width: `${optimizedPct}%` }} />
        </div>
      </div>
      <div className="plan-budget-note">
        {hasData ? `최적화 후 예상 사용률 ${optimizedPct}% · ${plan.sessionCount}개 세션 기준 · ${plan.note}` : `최근 5시간 ${plan.family === "openai" ? "Codex/OpenAI" : "Claude"} 세션 없음 · ${plan.note}`}
      </div>
    </div>
  );
}

function buildSubscriptionBudgets(results: DiagnosticResult[]): SubscriptionBudget[] {
  const openAiStats = buildProviderBudgetStats(results, "codex");
  const claudeStats = buildProviderBudgetStats(results, "claude");
  const openAiPlusBase = estimateBaseBudget(openAiStats.usedTokens, 120000);
  const claudeProBase = estimateBaseBudget(claudeStats.usedTokens, 90000);

  return [
    {
      name: "ChatGPT Plus",
      family: "openai",
      estimatedBudget: openAiPlusBase,
      usedTokens: openAiStats.sessionCount > 0 ? openAiStats.usedTokens : null,
      optimizedTokens: openAiStats.sessionCount > 0 ? openAiStats.optimizedTokens : null,
      sessionCount: openAiStats.sessionCount,
      basis: "Plus 1x 기준",
      note: "Plus는 고정 토큰량이 아니라 사용량 제한 기반",
    },
    {
      name: "ChatGPT Pro 5x",
      family: "openai",
      estimatedBudget: openAiPlusBase * 5,
      usedTokens: openAiStats.sessionCount > 0 ? openAiStats.usedTokens : null,
      optimizedTokens: openAiStats.sessionCount > 0 ? openAiStats.optimizedTokens : null,
      sessionCount: openAiStats.sessionCount,
      basis: "Plus 대비 5x",
      note: "Codex는 프로모션 기간에 더 높은 배수가 적용될 수 있음",
    },
    {
      name: "ChatGPT Pro 20x",
      family: "openai",
      estimatedBudget: openAiPlusBase * 20,
      usedTokens: openAiStats.sessionCount > 0 ? openAiStats.usedTokens : null,
      optimizedTokens: openAiStats.sessionCount > 0 ? openAiStats.optimizedTokens : null,
      sessionCount: openAiStats.sessionCount,
      basis: "Plus 대비 20x",
      note: "장시간/병렬 작업용 추정 상한",
    },
    {
      name: "Claude Pro",
      family: "claude",
      estimatedBudget: claudeProBase,
      usedTokens: claudeStats.sessionCount > 0 ? claudeStats.usedTokens : null,
      optimizedTokens: claudeStats.sessionCount > 0 ? claudeStats.optimizedTokens : null,
      sessionCount: claudeStats.sessionCount,
      basis: "Pro 1x 기준",
      note: "Claude는 메시지 길이와 피크 시간에 따라 실제 사용량 변동",
    },
    {
      name: "Claude Max 5x",
      family: "claude",
      estimatedBudget: claudeProBase * 5,
      usedTokens: claudeStats.sessionCount > 0 ? claudeStats.usedTokens : null,
      optimizedTokens: claudeStats.sessionCount > 0 ? claudeStats.optimizedTokens : null,
      sessionCount: claudeStats.sessionCount,
      basis: "Pro 대비 5x",
      note: "Claude Code도 같은 구독 사용량에 포함",
    },
    {
      name: "Claude Max 20x",
      family: "claude",
      estimatedBudget: claudeProBase * 20,
      usedTokens: claudeStats.sessionCount > 0 ? claudeStats.usedTokens : null,
      optimizedTokens: claudeStats.sessionCount > 0 ? claudeStats.optimizedTokens : null,
      sessionCount: claudeStats.sessionCount,
      basis: "Pro 대비 20x",
      note: "가장 긴 작업 블록용 추정 상한",
    },
  ];
}

function buildProviderBudgetStats(results: DiagnosticResult[], provider: "codex" | "claude") {
  const providerResults = results.filter(result => result.session.provider === provider);
  const usedTokens = providerResults.reduce((sum, result) => sum + getTotalTokens(result), 0);
  const wastedTokens = providerResults.reduce((sum, result) => sum + result.totalWastedTokens, 0);
  return {
    sessionCount: providerResults.length,
    usedTokens,
    optimizedTokens: Math.max(0, usedTokens - wastedTokens),
  };
}

function estimateBaseBudget(recentTokens: number, floorTokens: number): number {
  const buffer = Math.ceil((recentTokens * 1.25) / 10000) * 10000;
  return Math.max(floorTokens, buffer);
}

function getSessionTime(result: DiagnosticResult): number {
  const end = new Date(result.session.endTime).getTime();
  if (Number.isFinite(end)) return end;
  const start = new Date(result.session.startTime).getTime();
  return Number.isFinite(start) ? start : 0;
}

function getTotalTokens(result: DiagnosticResult): number {
  return result.session.totalInputTokens + result.session.totalOutputTokens + result.session.totalCacheReadTokens;
}

function buildVerdict(avgScore: number, riskCount: number, toolScore: number, retryScore: number, actionScore: number) {
  if (avgScore >= 75 && riskCount === 0 && toolScore >= 80 && retryScore >= 80 && actionScore >= 70) {
    return {
      label: "잘 쓰는 중",
      color: "var(--green)",
      message: "세션 목표가 비교적 명확하고 반복 낭비가 적습니다. 지금 방식은 유지하되 작업이 바뀔 때만 새 세션으로 나누면 됩니다.",
    };
  }
  if (avgScore < 40 || riskCount > 0 || toolScore < 55 || retryScore < 55) {
    return {
      label: "낭비 심함",
      color: "var(--red)",
      message: "지금은 더 긴 지침을 추가하기보다 세션을 나누고 실패 중단 기준을 먼저 잡아야 합니다.",
    };
  }
  return {
    label: "주의",
    color: "var(--orange)",
    message: "토큰을 많이 쓰는 것보다 같은 맥락을 오래 끌고 가는 방식에서 손실이 생기고 있습니다.",
  };
}

function buildVerdictReasons(results: DiagnosticResult[], toolScore: number, retryScore: number, actionScore: number, configScore: number): string[] {
  const mixed = results.filter(r => r.patterns.some(p => p.type === "SESSION_SCOPE_DRIFT" || p.type === "PHASE_MIXING")).length;
  const toolFailRate = Math.max(0, 100 - toolScore);
  const configTokens = Math.round((1 - configScore / 100) * 3000);
  const reasons = [
    `${results.length}개 세션 평균 건강 점수는 ${Math.round(results.reduce((s, r) => s + r.healthScore, 0) / Math.max(1, results.length))}점입니다.`,
    mixed > 0
      ? `최근 범위 ${results.length}개 중 ${mixed}개에서 기획/구현/검증 흐름이 섞였습니다.`
      : "최근 범위에서 큰 세션 범위 혼합은 적습니다.",
    toolFailRate >= 10
      ? `도구 실패율이 약 ${toolFailRate.toFixed(0)}%입니다. 같은 도구 재시도 기준을 정하세요.`
      : "도구 실패율은 낮은 편입니다.",
  ];

  if (retryScore < 80) reasons.push("반복 요청 신호가 있습니다. 실패 조건과 중단 기준을 먼저 적는 편이 좋습니다.");
  if (actionScore < 70) reasons.push("세션 집중도가 낮습니다. 기획, 구현, 검증을 별도 세션으로 나누세요.");
  if (configScore < 60) reasons.push(`설정 파일 상시 로딩 비용이 약 ${configTokens.toLocaleString("ko-KR")}토큰으로 큽니다.`);

  return reasons.slice(0, 3);
}

function buildTopWaste(results: DiagnosticResult[]): WasteCandidate[] {
  return results.flatMap(result => result.patterns.map(pattern => ({
    title: pattern.title,
    detail: decodeProjectName(result.session.project),
    tokens: pattern.estimatedWastedTokens,
    severity: pattern.severity,
  })))
    .sort((a, b) => b.tokens - a.tokens || severityRank(b.severity) - severityRank(a.severity))
    .slice(0, 3);
}

function buildPrimaryAction(topWaste: WasteCandidate | undefined, toolScore: number, retryScore: number, actionScore: number, configScore: number): string {
  if (topWaste?.title.includes("요청")) {
    return "질문 가이드에서 넓은 요청을 4요소 템플릿으로 바꾸고, 해당 프로젝트 AGENTS.md에 요청 압축 규칙을 짧게 남기세요.";
  }
  if (topWaste?.title.includes("도구") || toolScore < 70) {
    return "처방 탭에서 실패 중단 기준을 확인하세요. 전역 설정이 아니라 실패가 발생한 프로젝트 AGENTS.md에 같은 도구 2회 실패 후 대안을 보고하도록 남기세요.";
  }
  if (topWaste?.title.includes("세션") || actionScore < 70) {
    return "처방 탭에서 세션 분리 기준을 확인하세요. 기획, 구현, 검증 전환 규칙은 해당 프로젝트 AGENTS.md에 두는 편이 좋습니다.";
  }
  if (topWaste?.title.includes("로딩") || configScore < 60) {
    return "전역 설정은 대시보드에서 여러 세션 근거를 종합해 정리하세요. 필수 지침만 남기고 프로젝트별 긴 절차는 해당 AGENTS.md나 온디맨드 문서로 분리합니다.";
  }
  if (retryScore < 80) {
    return "반복 요청이 감지됩니다. 다음 요청에는 실패 조건, 중단 기준, 검증 기준을 먼저 넣으세요.";
  }
  return "현재 방식은 양호합니다. 다음 새 목표는 새 세션에서 시작하고, 첫 메시지에 범위와 완료 조건만 남기세요.";
}

function buildBlockAction(tokens: number, avgScore: number, actionScore: number): string {
  if (tokens > 120000 && actionScore < 70) {
    return `최근 5시간 사용량이 ${tokens.toLocaleString("ko-KR")}토큰입니다. 지금은 새 기능 구현보다 검증, 요약, 문서화처럼 짧은 작업을 권장합니다.`;
  }
  if (tokens > 120000) {
    return `최근 5시간 사용량이 ${tokens.toLocaleString("ko-KR")}토큰입니다. 큰 구현은 새 세션에서 시작하고 현재 세션은 결정 사항 요약으로 마무리하세요.`;
  }
  if (avgScore < 50) {
    return "사용량보다 작업 품질이 먼저입니다. 새 작업을 시작하기 전에 목표, 범위, 하지 않을 일, 완료 조건을 한 줄씩 고정하세요.";
  }
  return "현재 5시간 블록은 무리한 수준은 아닙니다. 구현을 계속해도 되지만 단계가 바뀌면 새 세션으로 분리하세요.";
}

function severityRank(severity: string): number {
  if (severity === "HIGH") return 3;
  if (severity === "MEDIUM") return 2;
  return 1;
}
