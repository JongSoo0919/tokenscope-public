import { WastePattern, DiagnosticResult, isContextBloatEvidence, isRetryStormEvidence, isToolThrashEvidence, isBroadRequestEvidence } from "./analyzer";
import { ClaudeSection, estimateTokens, isHumanVisibleMessage } from "./parser";
import { PROVIDER_CONFIGS, calculateCost, formatCost } from "./providers";

export interface Fix {
  patternType: WastePattern["type"];
  title: string;
  description: string;
  action: FixAction;
  beforeAfterComparison?: {
    beforeTokens: number;
    afterTokens: number;
    savedTokens: number;
    savedPercentage: number;
    savedCost: number;
    savedCostFormatted: string;
    basis: string;
    confidence: "HIGH" | "MEDIUM" | "LOW";
    sessionTotalTokens: number;
    sessionSavedPercentage: number;
    fiveHourTotalTokens?: number;
    fiveHourSavedPercentage?: number;
    averageUserTurnTokens?: number;
    equivalentUserTurns?: number;
  };
}

export interface UsageWindowContext {
  fiveHourTotalTokens: number;
  fiveHourUserTurns: number;
  analyzedSessionCount: number;
}

export type FixAction =
  | { kind: "edit_config_md"; provider: string; originalContent: string; suggestedContent: string; diff: DiffLine[] }
  | { kind: "info"; steps: string[] };

export interface DiffLine {
  type: "context" | "removed" | "added";
  content: string;
}

export function prescribe(result: DiagnosticResult, configMdContent: string, usageWindow?: UsageWindowContext): Fix[] {
  return result.patterns.map(p => prescribePattern(p, configMdContent, result, usageWindow)).filter((f): f is Fix => f !== null);
}

function prescribePattern(pattern: WastePattern, configMdContent: string, result: DiagnosticResult, usageWindow?: UsageWindowContext): Fix | null {
  switch (pattern.type) {
    case "CONTEXT_BLOAT":
      return prescribeContextBloat(pattern, configMdContent, result, usageWindow);
    case "RETRY_STORM":
      return prescribeRetryStorm(pattern, result, configMdContent, usageWindow);
    case "TOOL_THRASH":
      return prescribeToolThrash(pattern, result, configMdContent, usageWindow);
    case "SESSION_SCOPE_DRIFT":
    case "PHASE_MIXING":
      return prescribeSessionDiscipline(pattern, result, configMdContent, usageWindow);
    case "BROAD_REQUEST":
      return prescribeRequestCompression(pattern, result, configMdContent, usageWindow);
    default:
      return null;
  }
}

function prescribeContextBloat(pattern: WastePattern, configMdContent: string, result: DiagnosticResult, usageWindow?: UsageWindowContext): Fix {
  const evidence = pattern.evidence;
  const provider = result.session.provider;
  const configFileName = provider === "gemini" ? "GEMINI.md" : provider === "codex" ? "AGENTS.md" : "CLAUDE.md";

  if (!isContextBloatEvidence(evidence)) {
    return buildInfoFix(pattern, [`${configFileName} 내용을 검토하고 불필요한 섹션을 제거하세요.`]);
  }

  const { topOffenders } = evidence;
  const trimmed = trimConfigMd(configMdContent, topOffenders);
  const diff = buildDiff(configMdContent, trimmed);

  const beforeTokens = estimateTokens(configMdContent);
  const afterTokens = estimateTokens(trimmed);
  const msgCount = Math.max(1, result.session.messages.filter(m => m.role === "user" && isHumanVisibleMessage(m)).length);
  const beforeTotal = beforeTokens * msgCount;
  const afterTotal = afterTokens * msgCount;
  const savedTokens = beforeTotal - afterTotal;
  const savedPercentage = beforeTotal > 0 ? Math.round((savedTokens / beforeTotal) * 100) : 0;

  const savedCost = calculateCost(provider, savedTokens, 0, 0);
  const savedCostFormatted = formatCost(savedCost, PROVIDER_CONFIGS[provider].tokenPricing.currency);

  return {
    patternType: "CONTEXT_BLOAT",
    title: `${configFileName} 상시 지침 정리`,
    description: `가장 무거운 ${topOffenders.length}개 섹션에서 항상 필요한 규칙만 남기고 상황별 지침은 분리합니다.`,
    action: {
      kind: "edit_config_md",
      provider,
      originalContent: configMdContent,
      suggestedContent: trimmed,
      diff,
    },
    beforeAfterComparison: buildImpactComparison(
      result,
      savedTokens,
      beforeTotal,
      afterTotal,
      savedPercentage,
      savedCost,
      savedCostFormatted,
      "설정 파일 길이 x 현재 세션 사용자 요청 수",
      "MEDIUM",
      usageWindow
    ),
  };
}

function buildImpactComparison(
  result: DiagnosticResult,
  savedTokens: number,
  beforeTokens: number,
  afterTokens: number,
  savedPercentage: number,
  savedCost: number,
  savedCostFormatted: string,
  basis: string,
  confidence: "HIGH" | "MEDIUM" | "LOW",
  usageWindow?: UsageWindowContext
): NonNullable<Fix["beforeAfterComparison"]> {
  const sessionTotalTokens = getSessionTotalTokens(result);
  const userTurns = Math.max(1, result.session.messages.filter(m => m.role === "user" && isHumanVisibleMessage(m)).length);
  const windowTokens = usageWindow?.fiveHourTotalTokens ?? sessionTotalTokens;
  const windowTurns = usageWindow?.fiveHourUserTurns ?? userTurns;
  const averageUserTurnTokens = Math.round(windowTokens / Math.max(1, windowTurns));

  return {
    beforeTokens,
    afterTokens,
    savedTokens,
    savedPercentage,
    savedCost,
    savedCostFormatted,
    basis,
    confidence,
    sessionTotalTokens,
    sessionSavedPercentage: sessionTotalTokens > 0 ? Math.round((savedTokens / sessionTotalTokens) * 1000) / 10 : 0,
    fiveHourTotalTokens: windowTokens,
    fiveHourSavedPercentage: windowTokens > 0 ? Math.round((savedTokens / windowTokens) * 1000) / 10 : 0,
    averageUserTurnTokens,
    equivalentUserTurns: averageUserTurnTokens > 0 ? Math.round((savedTokens / averageUserTurnTokens) * 10) / 10 : 0,
  };
}

function buildPatternImpactComparison(
  pattern: WastePattern,
  result: DiagnosticResult,
  usageWindow?: UsageWindowContext
): NonNullable<Fix["beforeAfterComparison"]> {
  const savedTokens = Math.max(0, pattern.estimatedWastedTokens);
  const beforeTokens = getSessionTotalTokens(result);
  const afterTokens = Math.max(0, beforeTokens - savedTokens);
  const savedPercentage = beforeTokens > 0 ? Math.round((savedTokens / beforeTokens) * 100) : 0;
  const provider = result.session.provider;
  const savedCost = calculateCost(provider, savedTokens, 0, 0);
  const savedCostFormatted = formatCost(savedCost, PROVIDER_CONFIGS[provider].tokenPricing.currency);

  return buildImpactComparison(
    result,
    savedTokens,
    beforeTokens,
    afterTokens,
    savedPercentage,
    savedCost,
    savedCostFormatted,
    getPatternImpactBasis(pattern.type),
    "LOW",
    usageWindow
  );
}

function getSessionTotalTokens(result: DiagnosticResult): number {
  return result.session.totalInputTokens + result.session.totalOutputTokens + result.session.totalCacheReadTokens;
}

function getPatternImpactBasis(type: WastePattern["type"]): string {
  switch (type) {
    case "RETRY_STORM":
      return "반복 요청 수 x 보수적 재시도 비용";
    case "TOOL_THRASH":
      return "연속 실패 도구 호출 수 x 보수적 실패 비용";
    case "SESSION_SCOPE_DRIFT":
      return "작업 종류 수와 긴 세션 턴 수 기반 추정";
    case "PHASE_MIXING":
      return "기획/구현 혼합 패턴 기반 추정";
    case "BROAD_REQUEST":
      return "넓은 요청 수 x 보수적 세션 확장 비용";
    default:
      return "패턴 기반 추정";
  }
}

function trimConfigMd(content: string, topOffenders: ClaudeSection[]): string {
  const lines = content.split("\n");
  const result: string[] = [];
  let inOffender = false;
  let offenderTokens = 0;
  const offenderHeadings = new Set(topOffenders.map(s => `## ${s.heading}`));

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith("## ")) {
      inOffender = offenderHeadings.has(line);
      offenderTokens = 0;
    }

    if (inOffender) {
      offenderTokens += Math.ceil(line.length / 3);
      const headingLineIdx = lines.findIndex(l => offenderHeadings.has(l));
      const relIdx = i - headingLineIdx;
      if (relIdx === 0) {
        result.push(line);
      } else if (offenderTokens < 100) {
        result.push(line);
      } else if (!result.some(r => r.includes("# [압축됨]") || r.includes("[TRIMMED]"))) {
        result.push("# [온디맨드 분리 후보] 항상 필요한 핵심만 남기고 상세 지침은 별도 Skill/문서로 옮기세요.");
      }
    } else {
      result.push(line);
    }
  }

  return result.join("\n");
}

function prescribeRetryStorm(pattern: WastePattern, result: DiagnosticResult, configMdContent: string, usageWindow?: UsageWindowContext): Fix {
  const evidence = pattern.evidence;
  const provider = result.session.provider;
  const configFileName = provider === "gemini" ? "GEMINI.md" : provider === "codex" ? "AGENTS.md" : "CLAUDE.md";

  if (!isRetryStormEvidence(evidence)) {
    return buildInfoFix(pattern, ["반복 요청 패턴을 검토하세요."]);
  }

  const rules = [
    "같은 도구나 같은 접근이 2회 실패하면 세 번째 실행 전에 원인, 시도한 방법, 다음 대안을 짧게 보고한다.",
    "파일 없음, 권한 오류, 타입 오류는 같은 명령을 반복하지 말고 경로와 전제부터 확인한다.",
    "재시도 요청을 받으면 이전 시도와 다른 검증 기준을 먼저 정하고 진행한다.",
  ];

  return buildRulesFix(
    pattern,
    provider,
    configMdContent,
    `${configFileName}에 반복 재시도 방지 규칙 적용`,
    `감지된 반복 메시지 ${evidence.repeatedMessages.length}개를 줄이도록 재시도 중단 기준을 설정 파일에 추가합니다.`,
    rules,
    buildPatternImpactComparison(pattern, result, usageWindow)
  );
}

function prescribeToolThrash(pattern: WastePattern, result: DiagnosticResult, configMdContent: string, usageWindow?: UsageWindowContext): Fix {
  const evidence = pattern.evidence;
  const provider = result.session.provider;
  const configFileName = provider === "gemini" ? "GEMINI.md" : provider === "codex" ? "AGENTS.md" : "CLAUDE.md";

  if (!isToolThrashEvidence(evidence)) {
    return buildInfoFix(pattern, ["도구 사용 패턴을 검토하세요."]);
  }

  const rules = [
    `"${evidence.toolName}" 도구가 2회 실패하면 입력값과 경로를 재검증하고, 3회째부터는 같은 방식으로 재호출하지 않는다.`,
    "도구 실패가 반복되면 대체 도구, 더 작은 단위 실행, 또는 사용자 확인 중 하나로 전환한다.",
    "명령 실행 전 필요한 파일/디렉터리/권한이 맞는지 먼저 확인한다.",
  ];

  return buildRulesFix(
    pattern,
    provider,
    configMdContent,
    `${configFileName}에 도구 실패 대응 규칙 적용`,
    `"${evidence.toolName}" 연속 실패를 줄이도록 도구 재시도 한계와 대체 전략을 설정 파일에 추가합니다.`,
    rules,
    buildPatternImpactComparison(pattern, result, usageWindow)
  );
}

function prescribeSessionDiscipline(pattern: WastePattern, result: DiagnosticResult, configMdContent: string, usageWindow?: UsageWindowContext): Fix {
  const provider = result.session.provider;
  const configFileName = provider === "gemini" ? "GEMINI.md" : provider === "codex" ? "AGENTS.md" : "CLAUDE.md";
  const rules = [
    "한 세션에는 하나의 목표만 수행한다. 새 목표가 나오면 현재 결과를 5줄 이내로 요약하고 새 세션을 권장한다.",
    "기획이 끝나고 구현으로 넘어갈 때는 결정 사항, 파일 범위, 완료 조건만 요약하고 새 세션을 권장한다.",
    "구현이 끝나고 검증으로 넘어갈 때는 변경 파일과 실행할 테스트만 남기고 새 세션을 권장한다.",
  ];

  return buildRulesFix(
    pattern,
    provider,
    configMdContent,
    `${configFileName}에 세션 분리 규칙 적용`,
    "세션 범위 혼합으로 인한 토큰 누적을 줄이도록 작업 분리 규칙을 설정 파일에 추가합니다.",
    rules,
    buildPatternImpactComparison(pattern, result, usageWindow)
  );
}

function prescribeRequestCompression(pattern: WastePattern, result: DiagnosticResult, configMdContent: string, usageWindow?: UsageWindowContext): Fix {
  const provider = result.session.provider;
  const configFileName = provider === "gemini" ? "GEMINI.md" : provider === "codex" ? "AGENTS.md" : "CLAUDE.md";
  const evidence = pattern.evidence;
  const example = isBroadRequestEvidence(evidence) ? evidence.requests[0] : null;
  const rules = [
    "사용자 요청이 넓거나 모호하면 바로 실행하지 말고 목표, 수정 범위, 하지 말아야 할 일, 완료 조건 4요소로 재정리한다.",
    "재정리한 요청을 사용자에게 먼저 보여주고 승인 후 진행한다.",
    "전체적으로, 알아서, 좋게 같은 표현이 나오면 전체 수정으로 해석하지 말고 좁은 작업 단위와 검증 기준을 먼저 제안한다.",
  ];

  return buildRulesFix(
    pattern,
    provider,
    configMdContent,
    `${configFileName}에 사용자 요청 압축 도우미 적용`,
    example
      ? `넓은 요청을 실행 가능한 작업 단위로 바꾸도록 설정 파일에 압축 기준을 추가합니다. 예: "${example.improved}"`
      : "넓고 모호한 요청을 실행 가능한 작업 단위로 바꾸도록 설정 파일에 압축 기준을 추가합니다.",
    rules,
    buildPatternImpactComparison(pattern, result, usageWindow)
  );
}

function buildRulesFix(
  pattern: WastePattern,
  provider: string,
  configMdContent: string,
  title: string,
  description: string,
  rules: string[],
  beforeAfterComparison?: Fix["beforeAfterComparison"]
): Fix {
  const suggestedContent = upsertTokenScopeRules(configMdContent, rules);
  return {
    patternType: pattern.type,
    title,
    description,
    action: {
      kind: "edit_config_md",
      provider,
      originalContent: configMdContent,
      suggestedContent,
      diff: buildDiff(configMdContent, suggestedContent),
    },
    beforeAfterComparison,
  };
}

function upsertTokenScopeRules(content: string, rules: string[]): string {
  const heading = "## TokenScope 토큰 절약 규칙";
  const existing = content.trim();
  const previousRules = extractTokenScopeRules(existing, heading);
  const mergedRules = Array.from(new Set([...previousRules, ...rules]));
  const section = [
    heading,
    ...mergedRules.map(rule => `- ${rule}`),
  ].join("\n");
  const withoutOldSection = removeTokenScopeRules(existing, heading);
  return `${withoutOldSection ? `${withoutOldSection}\n\n` : ""}${section}\n`;
}

function extractTokenScopeRules(content: string, heading: string): string[] {
  const lines = content.split("\n");
  const start = lines.findIndex(line => line.trim() === heading);
  if (start < 0) return [];
  const rules: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("## ")) break;
    if (line.trim().startsWith("- ")) rules.push(line.trim().slice(2).trim());
  }
  return rules;
}

function removeTokenScopeRules(content: string, heading: string): string {
  const lines = content.split("\n");
  const start = lines.findIndex(line => line.trim() === heading);
  if (start < 0) return content.trim();
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].startsWith("## ")) {
      end = i;
      break;
    }
  }
  return [...lines.slice(0, start), ...lines.slice(end)].join("\n").trim();
}

function buildInfoFix(pattern: WastePattern, steps: string[]): Fix {
  return {
    patternType: pattern.type,
    title: pattern.title,
    description: pattern.description,
    action: { kind: "info", steps },
  };
}

function buildDiff(original: string, updated: string): DiffLine[] {
  const origLines = original.split("\n");
  const updLines = updated.split("\n");
  const diff: DiffLine[] = [];

  const maxLen = Math.max(origLines.length, updLines.length);
  for (let i = 0; i < maxLen; i++) {
    const o = origLines[i];
    const u = updLines[i];

    if (o === u) {
      diff.push({ type: "context", content: o ?? "" });
    } else {
      if (o !== undefined) diff.push({ type: "removed", content: o });
      if (u !== undefined) diff.push({ type: "added", content: u });
    }
  }

  return diff;
}

export function isEditConfigMdAction(a: FixAction): a is Extract<FixAction, { kind: "edit_config_md" }> {
  return a.kind === "edit_config_md";
}

export function isInfoAction(a: FixAction): a is Extract<FixAction, { kind: "info" }> {
  return a.kind === "info";
}
