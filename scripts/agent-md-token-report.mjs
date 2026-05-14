import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const reportPath = join(root, "docs/reports/agent-md-token-comparison.md");
const baseBranch = "product-plan2-action-loop";
const workBranch = "chore/agent-md-token-report";
const baseSha = "925d54d";
const tokenEstimate = (bytes) => Math.ceil(bytes / 4);

const beforeBytes = {
  "AGENTS.md": 643,
  "CLAUDE.md": 569,
  ".agents/skills/analyzer-skill/SKILL.md": 2683,
  ".agents/skills/parser-skill/SKILL.md": 1876,
  ".agents/skills/prescriber-skill/SKILL.md": 2227,
  ".agents/skills/tokenscope-orchestrator/SKILL.md": 7117,
  ".agents/skills/ui-skill/SKILL.md": 2049,
  ".claude/agents/analyzer-agent.md": 2443,
  ".claude/agents/parser-agent.md": 1479,
  ".claude/agents/prescriber-agent.md": 2860,
  ".claude/agents/ui-agent.md": 2138,
  ".claude/skills/analyzer-skill/SKILL.md": 2683,
  ".claude/skills/parser-skill/SKILL.md": 1888,
  ".claude/skills/prescriber-skill/SKILL.md": 2227,
  ".claude/skills/tokenscope-orchestrator/SKILL.md": 7123,
  ".claude/skills/ui-skill/SKILL.md": 2049,
  ".codex/agents/analyzer-agent.toml": 2472,
  ".codex/agents/parser-agent.toml": 1496,
  ".codex/agents/prescriber-agent.toml": 2889,
  ".codex/agents/ui-agent.toml": 2167,
};

const files = Object.keys(beforeBytes);

const scenarios = [
  {
    id: "Case 01",
    title: "레포 구조 설명",
    prompt: "이 레포 구조를 간단히 설명해줘.",
    files: ["AGENTS.md", "CLAUDE.md"],
  },
  {
    id: "Case 02",
    title: "세션 로그 파싱 수정",
    prompt: "Codex 세션 로그 파싱에서 깨진 JSONL 라인을 건너뛰도록 수정해줘.",
    files: ["AGENTS.md", ".agents/skills/parser-skill/SKILL.md", ".codex/agents/parser-agent.toml"],
  },
  {
    id: "Case 03",
    title: "건강 점수 점검",
    prompt: "건강 점수 계산 로직이 낭비 패턴을 잘 반영하는지 점검해줘.",
    files: ["AGENTS.md", ".agents/skills/analyzer-skill/SKILL.md", ".codex/agents/analyzer-agent.toml"],
  },
  {
    id: "Case 04",
    title: "AGENTS.md 처방",
    prompt: "AGENTS.md가 너무 긴지 분석하고 안전한 수정안을 만들어줘.",
    files: ["AGENTS.md", ".agents/skills/prescriber-skill/SKILL.md", ".codex/agents/prescriber-agent.toml"],
  },
  {
    id: "Case 05",
    title: "CLAUDE.md 처방",
    prompt: "CLAUDE.md 컨텍스트를 줄이는 diff와 질문 가이드를 만들어줘.",
    files: ["CLAUDE.md", ".claude/skills/prescriber-skill/SKILL.md", ".claude/agents/prescriber-agent.md"],
  },
  {
    id: "Case 06",
    title: "대시보드 UI 수정",
    prompt: "대시보드에서 건강 점수 상세 탭과 필터링 UI를 개선해줘.",
    files: ["AGENTS.md", ".agents/skills/ui-skill/SKILL.md", ".codex/agents/ui-agent.toml"],
  },
  {
    id: "Case 07",
    title: "Claude UI 작업",
    prompt: "Claude 기준으로 FixPreview와 DiffViewer UX를 개선해줘.",
    files: ["CLAUDE.md", ".claude/skills/ui-skill/SKILL.md", ".claude/agents/ui-agent.md"],
  },
  {
    id: "Case 08",
    title: "하네스 전체 재실행",
    prompt: "TokenScope 하네스를 이전 결과 기반으로 다시 실행하고 누락을 보완해줘.",
    files: ["AGENTS.md", ".agents/skills/tokenscope-orchestrator/SKILL.md"],
  },
  {
    id: "Case 09",
    title: "Claude 하네스 부분 재실행",
    prompt: "Claude 하네스에서 prescriber 단계만 재실행해줘.",
    files: ["CLAUDE.md", ".claude/skills/tokenscope-orchestrator/SKILL.md", ".claude/agents/prescriber-agent.md"],
  },
  {
    id: "Case 10",
    title: "PR 본문 작성",
    prompt: "현재 변경사항 기준으로 PR 본문과 검증 결과를 정리해줘.",
    files: ["AGENTS.md", "CLAUDE.md"],
  },
];

function readBytes(path) {
  return Buffer.byteLength(readFileSync(join(root, path)));
}

const afterBytes = Object.fromEntries(files.map((file) => [file, readBytes(file)]));

function rowsForScenario(scenario, bytesByFile) {
  return scenario.files.map((file) => {
    const bytes = bytesByFile[file] ?? 0;
    return { file, bytes, tokens: tokenEstimate(bytes) };
  });
}

function scenarioTotals(scenario, bytesByFile) {
  const promptTokens = tokenEstimate(Buffer.byteLength(scenario.prompt));
  const mdTokens = rowsForScenario(scenario, bytesByFile).reduce((sum, row) => sum + row.tokens, 0);
  return {
    promptTokens,
    mdTokens,
    totalTokens: promptTokens + mdTokens,
  };
}

const scenarioSummary = scenarios.map((scenario) => {
  const before = scenarioTotals(scenario, beforeBytes);
  const after = scenarioTotals(scenario, afterBytes);
  const saved = before.totalTokens - after.totalTokens;
  const improvement = before.totalTokens === 0 ? 0 : (saved / before.totalTokens) * 100;
  return { scenario, before, after, saved, improvement };
});

function aggregate(bytesByFile) {
  const usage = Object.fromEntries(files.map((file) => [file, 0]));
  for (const scenario of scenarios) {
    for (const file of scenario.files) usage[file] += 1;
  }
  return files
    .map((file) => {
      const bytes = bytesByFile[file] ?? 0;
      const tokens = tokenEstimate(bytes);
      return {
        file,
        uses: usage[file],
        bytes,
        tokens,
        totalTokens: tokens * usage[file],
      };
    })
    .filter((row) => row.uses > 0)
    .sort((a, b) => b.totalTokens - a.totalTokens);
}

const beforeTotal = scenarioSummary.reduce((sum, row) => sum + row.before.totalTokens, 0);
const afterTotal = scenarioSummary.reduce((sum, row) => sum + row.after.totalTokens, 0);
const savedTotal = beforeTotal - afterTotal;
const improvementTotal = (savedTotal / beforeTotal) * 100;
const best = [...scenarioSummary].sort((a, b) => b.saved - a.saved)[0];

function table(headers, rows) {
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");
}

function fmtPercent(value) {
  return `${value.toFixed(1)}%`;
}

const lines = [];
lines.push("# AI 에이전트 MD 토큰 비교 리포트");
lines.push("");
lines.push("Codex와 Claude가 자동 또는 명시적으로 읽을 수 있는 안내 Markdown/TOML 컨텍스트를 대상으로, 적용 전후의 토큰 추정치를 비교했다.");
lines.push("");
lines.push("## 핵심 요약");
lines.push("");
lines.push(table(
  ["항목", "값"],
  [
    ["전체 시나리오 적용 전 총 토큰", beforeTotal.toLocaleString()],
    ["전체 시나리오 적용 후 총 토큰", afterTotal.toLocaleString()],
    ["절감 토큰", savedTotal.toLocaleString()],
    ["개선율", fmtPercent(improvementTotal)],
    ["가장 큰 개선 시나리오", `${best.scenario.id} ${best.scenario.title} (${best.saved.toLocaleString()}토큰 절감)`],
  ],
));
lines.push("");
lines.push("## 범위");
lines.push("");
lines.push(table(
  ["구분", "내용"],
  [
    ["적용 전 기준", `${baseBranch} / ${baseSha} + 작업 전 untracked 파일 바이트 스냅샷`],
    ["적용 후 기준", workBranch],
    ["측정 대상", "`AGENTS.md`, `CLAUDE.md`, `.agents/skills`, `.claude/skills`, `.claude/agents`, `.codex/agents`"],
    ["시나리오 모델", "Codex/Claude 일반 사용자 요청 10개"],
  ],
));
lines.push("");
lines.push("## 리포팅 기준");
lines.push("");
lines.push("- 프롬프트 토큰: 프롬프트 UTF-8 바이트를 `ceil(bytes / 4)`로 추정");
lines.push("- MD 토큰: 읽힌 안내 파일 UTF-8 바이트를 `ceil(bytes / 4)`로 추정");
lines.push("- 총 토큰: 프롬프트 토큰 + MD 토큰");
lines.push("- 읽은 MD 파일: 전역 지침, 호출된 스킬, 호출된 에이전트 정의만 포함");
lines.push("- 개선율: `(적용 전 총 토큰 - 적용 후 총 토큰) / 적용 전 총 토큰`");
lines.push("- 제외 범위: 실제 구현 중 읽는 소스코드, 런타임 모델 내부 시스템 프롬프트, 정확한 vendor token counter");
lines.push("");
lines.push("## 요약");
lines.push("");
lines.push(table(
  ["Case", "시나리오", "적용 전", "적용 후", "절감", "개선율"],
  scenarioSummary.map((row) => [
    row.scenario.id,
    row.scenario.title,
    row.before.totalTokens.toLocaleString(),
    row.after.totalTokens.toLocaleString(),
    row.saved.toLocaleString(),
    fmtPercent(row.improvement),
  ]),
));
lines.push("");
lines.push("## MD 파일별 토큰 집계");
lines.push("");
lines.push("### 적용 전");
lines.push("");
lines.push(table(
  ["MD 파일", "사용 횟수", "1회 토큰", "총 토큰", "바이트"],
  aggregate(beforeBytes).map((row) => [
    `\`${row.file}\``,
    row.uses,
    row.tokens.toLocaleString(),
    row.totalTokens.toLocaleString(),
    row.bytes.toLocaleString(),
  ]),
));
lines.push("");
lines.push("### 적용 후");
lines.push("");
lines.push(table(
  ["MD 파일", "사용 횟수", "1회 토큰", "총 토큰", "바이트"],
  aggregate(afterBytes).map((row) => [
    `\`${row.file}\``,
    row.uses,
    row.tokens.toLocaleString(),
    row.totalTokens.toLocaleString(),
    row.bytes.toLocaleString(),
  ]),
));
lines.push("");
lines.push("## 시나리오 상세");
for (const row of scenarioSummary) {
  lines.push("");
  lines.push(`### ${row.scenario.id}: ${row.scenario.title}`);
  lines.push("");
  lines.push(`> ${row.scenario.prompt}`);
  lines.push("");
  lines.push(table(
    ["구분", "프롬프트 토큰", "MD 토큰", "총 토큰", "절감 토큰", "개선율"],
    [[
      "전후 비교",
      row.after.promptTokens.toLocaleString(),
      `${row.before.mdTokens.toLocaleString()} -> ${row.after.mdTokens.toLocaleString()}`,
      `${row.before.totalTokens.toLocaleString()} -> ${row.after.totalTokens.toLocaleString()}`,
      row.saved.toLocaleString(),
      fmtPercent(row.improvement),
    ]],
  ));
  lines.push("");
  lines.push("#### 적용 전 읽은 MD");
  lines.push("");
  lines.push(table(
    ["파일", "토큰", "바이트"],
    rowsForScenario(row.scenario, beforeBytes).map((item) => [
      `\`${item.file}\``,
      item.tokens.toLocaleString(),
      item.bytes.toLocaleString(),
    ]),
  ));
  lines.push("");
  lines.push("#### 적용 후 읽은 MD");
  lines.push("");
  lines.push(table(
    ["파일", "토큰", "바이트"],
    rowsForScenario(row.scenario, afterBytes).map((item) => [
      `\`${item.file}\``,
      item.tokens.toLocaleString(),
      item.bytes.toLocaleString(),
    ]),
  ));
}
lines.push("");
lines.push("## 적용 변경");
lines.push("");
lines.push("- Cursor 전용 계획을 Codex/Claude 중심의 AI 에이전트 안내 컨텍스트 최적화 계획으로 변경했다.");
lines.push("- `.agents/skills`와 `.claude/skills`의 중복 장문 설명을 역할, 입력, 출력, 실패 처리 중심으로 압축했다.");
lines.push("- `.claude/agents`와 `.codex/agents` 정의에서 긴 예시와 반복 설명을 제거했다.");
lines.push("- 전역 파일은 이미 작아 유지하고, 스킬/에이전트 문서 중복을 주요 병목으로 처리했다.");
lines.push("");
lines.push("## 해석");
lines.push("");
lines.push("이번 개선은 자동/명시 호출 가능성이 높은 지침 파일을 줄이는 데 초점을 맞췄다. 실제 Codex/Claude 내부 token counter가 아니라 동일한 로컬 추정식을 사용했으므로 절대 토큰 수는 근사치다. 다만 전후 비교에는 같은 계산식을 적용했기 때문에 상대 개선율은 병목 감소 방향을 판단하는 기준으로 사용할 수 있다.");
lines.push("");

mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(reportPath, `${lines.join("\n")}\n`);

console.log(JSON.stringify({
  reportPath: "docs/reports/agent-md-token-comparison.md",
  beforeTotal,
  afterTotal,
  savedTotal,
  improvementTotal: Number(improvementTotal.toFixed(1)),
  bestScenario: `${best.scenario.id} ${best.scenario.title}`,
}, null, 2));
