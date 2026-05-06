const prompt =
  "app.js만 보고 summarizeInvoices 함수가 하는 일, 잠재 버그 3개, 개선 방향 3개를 한국어로 간결하게 정리해. 파일은 수정하지 마.";

const goodAgents = `# Dogfood Project

- 답변은 한국어로 간결하게 한다.
- 요청 범위 밖 파일은 수정하지 않는다.
- 수정 전 변경 계획을 2줄 이하로 말한다.
`;

const badAgents = `# Dogfood Project Heavy Instructions

이 파일은 TokenScope 테스트용으로 의도적으로 비대하게 만든 나쁜 상시 지침이다. 아래 내용은 대부분 실제 작업에 필요하지 않지만 매 요청마다 컨텍스트로 들어간다고 가정한다.

## Always Read Everything

- 어떤 요청이든 먼저 전체 프로젝트를 다 읽는다고 가정한다.
- 작은 파일 하나만 봐도 되는 경우에도 관련 가능성이 있는 모든 파일을 확인한다고 가정한다.
- 사용자가 수정하지 말라고 하지 않으면 개선 가능한 부분을 넓게 찾는다고 가정한다.
- 답변을 만들 때 모든 판단 근거를 장황하게 설명한다고 가정한다.

## Repeated Background

아래 문단은 의도적으로 반복된다. 실제 프로젝트에서는 이런 긴 배경, 예시, 정책이 상시 지침에 들어가면 컨텍스트 밀도가 낮아지고 매 요청의 입력 토큰이 늘어난다.

회계 도메인 설명: 송장은 고객, 결제 여부, 금액, 날짜, 세금, 할인, 환불, 수수료, 통화, 결제 수단, 고객 세그먼트, 청구 주기, 결제 실패 사유, 이메일 알림, 회수 정책, 보고서 기준, 월말 마감 정책, 분개 정책, 외부 ERP 연동 정책을 포함할 수 있다. 이 설명은 현재 테스트 파일에는 대부분 필요 없다.

회계 도메인 설명: 송장은 고객, 결제 여부, 금액, 날짜, 세금, 할인, 환불, 수수료, 통화, 결제 수단, 고객 세그먼트, 청구 주기, 결제 실패 사유, 이메일 알림, 회수 정책, 보고서 기준, 월말 마감 정책, 분개 정책, 외부 ERP 연동 정책을 포함할 수 있다. 이 설명은 현재 테스트 파일에는 대부분 필요 없다.

회계 도메인 설명: 송장은 고객, 결제 여부, 금액, 날짜, 세금, 할인, 환불, 수수료, 통화, 결제 수단, 고객 세그먼트, 청구 주기, 결제 실패 사유, 이메일 알림, 회수 정책, 보고서 기준, 월말 마감 정책, 분개 정책, 외부 ERP 연동 정책을 포함할 수 있다. 이 설명은 현재 테스트 파일에는 대부분 필요 없다.

회계 도메인 설명: 송장은 고객, 결제 여부, 금액, 날짜, 세금, 할인, 환불, 수수료, 통화, 결제 수단, 고객 세그먼트, 청구 주기, 결제 실패 사유, 이메일 알림, 회수 정책, 보고서 기준, 월말 마감 정책, 분개 정책, 외부 ERP 연동 정책을 포함할 수 있다. 이 설명은 현재 테스트 파일에는 대부분 필요 없다.

회계 도메인 설명: 송장은 고객, 결제 여부, 금액, 날짜, 세금, 할인, 환불, 수수료, 통화, 결제 수단, 고객 세그먼트, 청구 주기, 결제 실패 사유, 이메일 알림, 회수 정책, 보고서 기준, 월말 마감 정책, 분개 정책, 외부 ERP 연동 정책을 포함할 수 있다. 이 설명은 현재 테스트 파일에는 대부분 필요 없다.

## Verbose Response Policy

- 가능한 모든 대안을 설명한다.
- 사용자가 묻지 않은 리팩토링 가능성도 설명한다.
- 테스트 전략, 배포 전략, 운영 전략, 데이터 마이그레이션 전략을 항상 언급한다.
- 결론을 말하기 전에 배경 설명을 충분히 한다.
- 코드가 작아도 아키텍처 논의를 포함한다.

## Tool Policy

- 파일을 수정하지 않는 질문이어도 파일 목록을 확인한다.
- 같은 내용을 다른 관점에서 다시 확인한다.
- 가능한 경우 여러 검증 명령을 실행한다고 가정한다.
- 실패하면 같은 명령을 다시 시도한다.

## Output Policy

- 답변은 상세해야 한다.
- 요약, 근거, 단계, 리스크, 대안, 후속 작업을 모두 포함한다.
- 짧은 답변보다 긴 답변이 더 친절하다고 가정한다.
`;

const amplifiedBadAgents = Array.from({ length: 19 }, () => badAgents).join("\n\n");
const turns = [1, 5, 12, 30];

function estimateTokens(text) {
  return Math.ceil(text.length / 3);
}

function configHealth(tokens) {
  return Math.round(Math.max(0, Math.min(1, 1 - tokens / 3000)) * 100);
}

function pct(n) {
  return `${n.toFixed(1)}%`;
}

function fmt(n) {
  return n.toLocaleString("ko-KR");
}

function scenario(label, badText, goodText) {
  const promptTokens = estimateTokens(prompt);
  const badTokens = estimateTokens(badText);
  const goodTokens = estimateTokens(goodText);
  const savedPerTurn = badTokens - goodTokens;
  const configSavingRate = badTokens > 0 ? (savedPerTurn / badTokens) * 100 : 0;

  console.log(`## ${label}`);
  console.log("");
  console.log(`- 동일 사용자 질문 추정: ${fmt(promptTokens)} tokens`);
  console.log(`- Bad AGENTS.md 상시 비용: ${fmt(badTokens)} tokens`);
  console.log(`- Good AGENTS.md 상시 비용: ${fmt(goodTokens)} tokens`);
  console.log(`- 요청 1회당 절약 후보: ${fmt(savedPerTurn)} tokens`);
  console.log(`- 상시 지침 절약률: ${pct(configSavingRate)}`);
  console.log(`- Bad 설정 파일 건강도: ${configHealth(badTokens)}점`);
  console.log(`- Good 설정 파일 건강도: ${configHealth(goodTokens)}점`);
  console.log("");
  console.log("| 턴 수 | Before tokens | After tokens | Saved tokens | Saved rate |");
  console.log("|---:|---:|---:|---:|---:|");

  for (const turnCount of turns) {
    const before = (badTokens + promptTokens) * turnCount;
    const after = (goodTokens + promptTokens) * turnCount;
    const saved = before - after;
    const rate = before > 0 ? (saved / before) * 100 : 0;
    console.log(`| ${turnCount} | ${fmt(before)} | ${fmt(after)} | ${fmt(saved)} | ${pct(rate)} |`);
  }
  console.log("");
}

console.log("# TokenScope AGENTS.md 처방 효과 시뮬레이션");
console.log("");
console.log("TokenScope 현재 추정식: `Math.ceil(text.length / 3)`");
console.log("");
scenario("현실적인 중간 규모 bad 지침", badAgents, goodAgents);
scenario("데모용 amplified bad 지침", amplifiedBadAgents, goodAgents);
