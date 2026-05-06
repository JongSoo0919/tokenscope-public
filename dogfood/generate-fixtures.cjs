const fs = require("fs");
const path = require("path");

const outDir = path.join(__dirname, "sessions");
fs.mkdirSync(outDir, { recursive: true });

const badBackground = `회계 도메인 설명: 송장은 고객, 결제 여부, 금액, 날짜, 세금, 할인, 환불, 수수료, 통화, 결제 수단, 고객 세그먼트, 청구 주기, 결제 실패 사유, 이메일 알림, 회수 정책, 보고서 기준, 월말 마감 정책, 분개 정책, 외부 ERP 연동 정책을 포함할 수 있다. 이 설명은 현재 테스트 파일에는 대부분 필요 없다.`;

const heavyAgents = `# Dogfood Heavy AGENTS.md

## Always Read Everything

아래 지침은 의도적으로 과도하게 무겁다. 어떤 요청이든 전체 프로젝트를 모두 읽고, 사용자가 묻지 않은 리팩토링 가능성, 테스트 전략, 배포 전략, 운영 전략, 데이터 마이그레이션 전략을 모두 언급한다. 작은 파일 하나만 봐도 되는 경우에도 관련 가능성이 있는 모든 파일을 확인한다고 가정한다. 답변을 만들 때 모든 판단 근거를 장황하게 설명한다.

## Repeated Background

${Array.from({ length: 45 }, () => badBackground).join("\n\n")}

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
`;

const goodAgents = `# Dogfood Project

- 답변은 한국어로 간결하게 한다.
- 요청 범위 밖 파일은 수정하지 않는다.
- 수정 전 변경 계획을 2줄 이하로 말한다.
`;

function line(value) {
  return JSON.stringify(value);
}

function user(text, timestamp) {
  return line({
    type: "response_item",
    payload: { type: "message", role: "user", content: [{ type: "input_text", text }] },
    timestamp,
  });
}

function assistant(text, timestamp) {
  return line({
    type: "response_item",
    payload: { type: "message", role: "assistant", content: [{ type: "output_text", text }] },
    timestamp,
  });
}

function call(name, callId, timestamp) {
  return line({
    type: "response_item",
    payload: { type: "function_call", name, call_id: callId, arguments: "{}" },
    timestamp,
  });
}

function output(callId, outputText, timestamp) {
  return line({
    type: "response_item",
    payload: { type: "function_call_output", call_id: callId, output: outputText },
    timestamp,
  });
}

function tokenCount(input, outputTokens, timestamp) {
  return line({
    type: "event_msg",
    payload: {
      type: "token_count",
      info: { last_token_usage: { input_tokens: input, output_tokens: outputTokens, cached_input_tokens: 0, reasoning_output_tokens: 0 } },
    },
    timestamp,
  });
}

function fixtureMeta(name, configMd, timestamp, cwd) {
  return [
    line({ type: "tokenscope_fixture", fixtureName: name, fixtureConfigMd: configMd, timestamp }),
    line({ type: "session_meta", payload: { model_provider: "openai", model: "tokenscope-dogfood", timestamp, cwd } }),
  ];
}

const badLines = [
  ...fixtureMeta("Dogfood Bad: heavy instructions and drift", heavyAgents, "2026-05-06T01:00:00Z", "/dogfood-bad"),
  user("[Dogfood Bad] 전체적으로 한번 봐줘. app.js도 보고 문제 있으면 알아서 좋게 개선 방향까지 다 정리해줘.", "2026-05-06T01:01:00Z"),
  assistant("범위가 넓어서 먼저 파일과 실행 가능성을 확인하겠습니다.", "2026-05-06T01:01:20Z"),
  call("shell", "bad-call-1", "2026-05-06T01:01:30Z"),
  output("bad-call-1", "error: app.js: No such file or directory", "2026-05-06T01:01:35Z"),
  call("shell", "bad-call-2", "2026-05-06T01:01:40Z"),
  output("bad-call-2", "error: app.js: No such file or directory", "2026-05-06T01:01:45Z"),
  call("shell", "bad-call-3", "2026-05-06T01:01:50Z"),
  output("bad-call-3", "error: app.js: No such file or directory", "2026-05-06T01:01:55Z"),
  user("[Dogfood Bad] 전체적으로 한번 봐줘. app.js도 보고 문제 있으면 알아서 좋게 개선 방향까지 다 정리해줘.", "2026-05-06T01:02:10Z"),
  assistant("같은 요청을 다시 받았습니다. 기획, 구현, 검증 관점까지 함께 정리하겠습니다.", "2026-05-06T01:02:20Z"),
  user("[Dogfood Bad] 전체적으로 한번 봐줘. app.js도 보고 문제 있으면 알아서 좋게 개선 방향까지 다 정리해줘.", "2026-05-06T01:03:10Z"),
  assistant("세션 범위가 넓어졌지만 계속 진행합니다.", "2026-05-06T01:03:20Z"),
  user("이제 이걸 구현까지 해주고 테스트도 확인하고 리뷰도 같이 해줘.", "2026-05-06T01:04:00Z"),
  assistant("기획, 구현, 검증, 리뷰가 같은 세션에서 섞였습니다. summarizeInvoices는 total, paid, unpaid를 계산하지만 입력 검증이 부족합니다.", "2026-05-06T01:04:30Z"),
  tokenCount(220000, 1200, "2026-05-06T01:04:40Z"),
];

const goodLines = [
  ...fixtureMeta("Dogfood Good: trimmed instructions and scoped request", goodAgents, "2026-05-06T01:10:00Z", "/dogfood-good"),
  user("[Dogfood Good] app.js만 보고 summarizeInvoices 함수가 하는 일, 잠재 버그 3개, 개선 방향 3개를 한국어로 간결하게 정리해. 파일은 수정하지 마.", "2026-05-06T01:11:00Z"),
  assistant("summarizeInvoices는 송장 배열을 순회해 total, paid, unpaid 금액을 계산합니다. 잠재 버그는 rows 타입 검증 없음, amount 숫자 검증 없음, paid 값의 엄격한 불리언 검증 없음입니다. 개선 방향은 입력 검증, paid === true 엄격 비교, 유효하지 않은 amount 처리 정책 추가입니다.", "2026-05-06T01:12:00Z"),
  tokenCount(900, 95, "2026-05-06T01:12:10Z"),
];

fs.writeFileSync(path.join(outDir, "2026-05-06-dogfood-bad.jsonl"), `${badLines.join("\n")}\n`);
fs.writeFileSync(path.join(outDir, "2026-05-06-dogfood-good.jsonl"), `${goodLines.join("\n")}\n`);

console.log(`wrote ${badLines.length} bad fixture lines`);
console.log(`wrote ${goodLines.length} good fixture lines`);
console.log(`bad config chars: ${heavyAgents.length}`);
console.log(`good config chars: ${goodAgents.length}`);
