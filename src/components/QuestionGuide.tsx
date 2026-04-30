import { WastePattern, ScoreBreakdown, isContextBloatEvidence, isRetryStormEvidence, isToolThrashEvidence } from "../lib/analyzer";

interface Props {
  patterns: WastePattern[];
  scoreBreakdown: ScoreBreakdown;
}

interface Tip { title: string; body: string }

function TipCard({ tip, accent = "var(--accent)" }: { tip: Tip; accent?: string }) {
  return (
    <div style={{ marginBottom: 8, padding: "10px 12px", background: "var(--surface2)", borderRadius: 6, borderLeft: `3px solid ${accent}` }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text)", marginBottom: 4 }}>{tip.title}</div>
      <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.6 }}>{tip.body}</div>
    </div>
  );
}

const METRIC_TIPS: Record<string, Tip[]> = {
  cache: [
    { title: "작업 초반에 필요한 파일을 모두 로드하세요", body: "대화 중반에 새 파일을 추가로 Read하면 캐시가 무효화됩니다. 필요한 컨텍스트를 세션 초반에 한 번에 준비하세요." },
    { title: "한 세션, 한 주제 원칙을 지키세요", body: "무관한 작업을 같은 세션에 섞으면 컨텍스트가 자주 바뀌어 캐시 효율이 떨어집니다. 작업별로 세션을 분리하세요." },
    { title: "CLAUDE.md 구조를 안정적으로 유지하세요", body: "CLAUDE.md 내용이 바뀔 때마다 캐시가 재생성됩니다. 자주 편집하기보다 처음부터 안정된 지침을 작성하는 것이 중요합니다." },
  ],
  tool: [
    { title: "도구 3회 실패 시 대안 전략을 명시하세요", body: 'CLAUDE.md에 "같은 도구로 3회 이상 실패하면 다른 접근법을 시도하거나 사용자에게 보고하라"고 명시하면 반복 실패를 막을 수 있습니다.' },
    { title: "파일 경로는 항상 절대경로를 사용하도록 명시하세요", body: "상대경로는 실행 위치에 따라 달라져 도구 실패를 유발합니다. CLAUDE.md에 절대경로 사용을 강제하세요." },
    { title: "작업 전 파일 존재 여부 확인 단계를 추가하세요", body: '파일·디렉토리 존재 여부를 먼저 Bash로 확인 후 작업하도록 지침을 추가하면 "파일 없음" 오류를 크게 줄일 수 있습니다.' },
  ],
  context: [
    { title: "출력 형식과 기대 길이를 구체적으로 요청하세요", body: '"3문장으로 요약" 또는 "코드 블록 포함해 상세히"처럼 출력 형식을 명시하면 같은 비용으로 더 유용한 답변을 받을 수 있습니다.' },
    { title: "목적·현황·원하는 결과를 한 번에 포함하세요", body: "모호한 질문은 짧고 단편적인 답변을 유발합니다. 맥락을 충분히 제공하면 컨텍스트 대비 출력 효율이 높아집니다." },
  ],
  claudeMd: [
    { title: "CLAUDE.md를 1,500자 이내로 유지하세요", body: "매 요청마다 CLAUDE.md 전체가 전송됩니다. 구체적인 예시보다 원칙만 남기고, 오래된 지침은 삭제하세요." },
    { title: "섹션별 우선순위를 매기고 하위 섹션을 제거하세요", body: "자주 쓰지 않는 섹션은 별도 파일로 분리하거나 삭제하세요. Claude에 자주 주는 지침만 남기세요." },
    { title: "반복되는 내용을 통합하세요", body: "비슷한 지침이 여러 섹션에 분산되어 있다면 하나로 합치면 토큰을 즉시 줄일 수 있습니다." },
  ],
  retry: [
    { title: "실패 시 즉시 다른 전략을 쓰도록 명시하세요", body: 'CLAUDE.md에 "동일 접근법으로 2회 이상 실패하면 전략을 바꾸거나 사용자에게 상황을 보고하라"고 명시하세요.' },
    { title: "복잡한 작업에 중간 체크포인트를 추가하세요", body: "단계별 확인 시점을 명시하면 Claude가 길을 잃지 않아 반복 시도가 줄어듭니다." },
    { title: "에러 메시지를 포함해서 재요청하세요", body: "에러가 발생하면 에러 메시지 전체를 포함해 다시 요청하면 Claude가 맥락을 이해해 같은 실수를 반복하지 않습니다." },
  ],
};

const GENERAL_TIPS: Tip[] = [
  { title: "새 작업은 새 세션에서 시작하세요", body: "이전 작업의 컨텍스트가 남아있으면 불필요한 입력 토큰이 계속 누적됩니다. 관련 없는 새 작업은 항상 새 세션에서 시작하는 것이 효율적입니다." },
  { title: "CLAUDE.md 정기 점검을 습관화하세요", body: "한 달에 한 번 CLAUDE.md를 검토하고 실제로 사용하는 지침만 남기세요. 누적된 지침이 토큰 비용을 조용히 높이고 있을 수 있습니다." },
  { title: "캐시 사용량을 모니터링하세요", body: "cache_read_tokens가 input_tokens보다 훨씬 적다면 컨텍스트가 자주 바뀌고 있다는 신호입니다. 작업 구조를 점검해보세요." },
];

export function QuestionGuide({ patterns, scoreBreakdown }: Props) {
  const { cacheEfficiency, toolSuccessRate, contextDensity, claudeMdHealth, retryHealth } = scoreBreakdown;

  const lowMetrics: { label: string; score: number; tips: Tip[] }[] = [];
  if (cacheEfficiency < 60)  lowMetrics.push({ label: "캐시 효율 개선",   score: cacheEfficiency,  tips: METRIC_TIPS.cache });
  if (toolSuccessRate < 80)  lowMetrics.push({ label: "도구 성공률 개선", score: toolSuccessRate,  tips: METRIC_TIPS.tool });
  if (contextDensity < 50)   lowMetrics.push({ label: "컨텍스트 밀도 개선", score: contextDensity, tips: METRIC_TIPS.context });
  if (claudeMdHealth < 60)   lowMetrics.push({ label: "CLAUDE.md 최적화", score: claudeMdHealth,  tips: METRIC_TIPS.claudeMd });
  if (retryHealth < 70)      lowMetrics.push({ label: "반복 요청 억제",   score: retryHealth,     tips: METRIC_TIPS.retry });

  return (
    <div>
      {/* 패턴 기반 가이드 */}
      {patterns.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-title">감지된 패턴 개선 가이드</div>
          {patterns.map((pattern, i) => (
            <div key={i} style={{ marginBottom: i < patterns.length - 1 ? 20 : 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", marginBottom: 10 }}>
                <span style={{
                  fontSize: 10, padding: "2px 6px", borderRadius: 10, marginRight: 8,
                  background: pattern.severity === "HIGH" ? "rgba(255,95,95,0.2)" : pattern.severity === "MEDIUM" ? "rgba(255,170,77,0.2)" : "rgba(255,216,77,0.2)",
                  color: pattern.severity === "HIGH" ? "var(--red)" : pattern.severity === "MEDIUM" ? "var(--orange)" : "var(--yellow)",
                }}>{pattern.severity}</span>
                {pattern.title}
              </div>

              {pattern.type === "CONTEXT_BLOAT" && isContextBloatEvidence(pattern.evidence) && (
                <>
                  <TipCard tip={{ title: "무거운 섹션을 핵심 원칙으로 압축하세요", body: `상위 ${pattern.evidence.topOffenders.length}개 섹션이 전체 토큰의 대부분을 차지합니다. 각 섹션을 3-5줄로 압축하거나, 자주 쓰지 않으면 삭제하세요.` }} />
                  <TipCard tip={{ title: "코드 예시를 CLAUDE.md에서 제거하세요", body: "코드 예시는 토큰을 많이 소모합니다. 예시 대신 '어떻게'에 대한 원칙만 짧게 서술하면 같은 효과를 낼 수 있습니다." }} />
                </>
              )}

              {pattern.type === "RETRY_STORM" && isRetryStormEvidence(pattern.evidence) && (
                <>
                  <TipCard tip={{ title: "반복 메시지 패턴 분석", body: `동일 메시지가 ${pattern.evidence.repeatedMessages[0]?.count ?? 0}회 이상 반복됐습니다. Claude가 이 요청에서 반복적으로 실패하고 있다는 신호입니다.` }} accent="var(--orange)" />
                  <TipCard tip={{ title: "지침을 더 명확하게 바꾸세요", body: '반복 요청은 보통 지침의 모호함이 원인입니다. "정확히 어떻게"를 명시하면 첫 번째 시도에서 해결될 가능성이 높아집니다.' }} accent="var(--orange)" />
                </>
              )}

              {pattern.type === "TOOL_THRASH" && isToolThrashEvidence(pattern.evidence) && (
                <>
                  <TipCard tip={{ title: `${pattern.evidence.toolName} 실패 대응 지침 추가`, body: `이 도구가 ${pattern.evidence.consecutiveErrors}회 연속 실패했습니다. CLAUDE.md에 실패 시 즉시 대안을 시도하도록 명시하세요.` }} accent="var(--red)" />
                  <TipCard tip={{ title: "입력 유효성 검사를 먼저 수행하도록 지침 추가", body: "도구 호출 전 입력값이 유효한지 확인하는 단계를 CLAUDE.md에 명시하면 같은 오류 반복을 크게 줄일 수 있습니다." }} accent="var(--red)" />
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 낮은 지표 개선 팁 */}
      {lowMetrics.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-title">낮은 점수 지표 개선 방법</div>
          {lowMetrics.map((metric, i) => (
            <div key={i} style={{ marginBottom: i < lowMetrics.length - 1 ? 20 : 0 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <span style={{ fontSize: 13, fontWeight: 700 }}>{metric.label}</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: "var(--orange)" }}>{Math.round(metric.score)}점</span>
              </div>
              {metric.tips.map((tip, j) => <TipCard key={j} tip={tip} />)}
            </div>
          ))}
        </div>
      )}

      {lowMetrics.length === 0 && patterns.length === 0 && (
        <div className="card" style={{ marginBottom: 16, textAlign: "center", color: "var(--green)" }}>
          모든 지표가 양호합니다. 아래 베스트 프랙티스를 참고해 더욱 최적화하세요.
        </div>
      )}

      {/* 일반 베스트 프랙티스 */}
      <div className="card">
        <div className="card-title">Claude Code 효율 베스트 프랙티스</div>
        {GENERAL_TIPS.map((tip, i) => <TipCard key={i} tip={tip} />)}
      </div>
    </div>
  );
}
