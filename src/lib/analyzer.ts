import { ParsedMessage, SessionData, ClaudeSection, parseClaudeMd, estimateTokens, isHumanVisibleMessage } from "./parser";
import { PROVIDER_CONFIGS, calculateCost, formatCost } from "./providers";

export type WastePatternType =
  | "CONTEXT_BLOAT"
  | "RETRY_STORM"
  | "TOOL_THRASH"
  | "SESSION_SCOPE_DRIFT"
  | "PHASE_MIXING";

export interface WastePattern {
  type: WastePatternType;
  severity: "HIGH" | "MEDIUM" | "LOW";
  title: string;
  description: string;
  estimatedWastedTokens: number;
  evidence: WasteEvidence;
}

export interface ContextBloatEvidence {
  sections: ClaudeSection[];
  totalEstimatedTokens: number;
  topOffenders: ClaudeSection[];
}

export interface RetryStormEvidence {
  repeatedMessages: { text: string; count: number }[];
  totalExtraMessages: number;
}

export interface ToolThrashEvidence {
  toolName: string;
  consecutiveErrors: number;
  messageIndices: number[];
}

export interface SessionScopeEvidence {
  detectedWorkTypes: string[];
  userTurns: number;
  recommendation: string;
}

export interface PhaseMixingEvidence {
  phases: string[];
  recommendation: string;
}

export type WasteEvidence =
  | ContextBloatEvidence
  | RetryStormEvidence
  | ToolThrashEvidence
  | SessionScopeEvidence
  | PhaseMixingEvidence;

export interface ScoreBreakdown {
  cacheEfficiency: number;   // 0-100
  toolSuccessRate: number;   // 0-100
  contextDensity: number;    // 0-100
  claudeMdHealth: number;    // 0-100: CLAUDE.md/GEMINI.md health
  retryHealth: number;       // 0-100
  actionFocus: number;       // 0-100
  overall: number;           // weighted avg
  explanations: {
    cacheEfficiency: string;
    toolSuccessRate: string;
    contextDensity: string;
    claudeMdHealth: string;
    retryHealth: string;
    actionFocus: string;
  };
}

export interface SessionDigest {
  headline: string;
  keyRequests: string[];
  assistantActions: string[];
  tokenAdvice: string[];
}

export interface DiagnosticResult {
  session: SessionData;
  patterns: WastePattern[];
  totalWastedTokens: number;
  healthScore: number;
  scoreBreakdown: ScoreBreakdown;
  sessionSummary: string;
  sessionDigest: SessionDigest;
  estimatedCost: number;
  estimatedCostFormatted: string;
}

const CONTEXT_BLOAT_THRESHOLD = 667; 
const RETRY_STORM_MIN_REPEATS = 3;
const TOOL_THRASH_MIN_CONSECUTIVE = 3;

export function analyzeSession(session: SessionData, configMdContent: string): DiagnosticResult {
  const patterns: WastePattern[] = [];

  const bloat = detectContextBloat(configMdContent, session.provider);
  if (bloat) patterns.push(bloat);

  const retry = detectRetryStorm(session.messages);
  if (retry) patterns.push(retry);

  const thrash = detectToolThrash(session.messages);
  if (thrash) patterns.push(...thrash);

  const scopeDrift = detectSessionScopeDrift(session.messages);
  if (scopeDrift) patterns.push(scopeDrift);

  const phaseMixing = detectPhaseMixing(session.messages);
  if (phaseMixing) patterns.push(phaseMixing);

  const totalWastedTokens = patterns.reduce((sum, p) => sum + p.estimatedWastedTokens, 0);
  const scoreBreakdown = computeScoreBreakdown(session, configMdContent, patterns);
  const sessionDigest = extractSessionDigest(session.messages, scoreBreakdown);
  const sessionSummary = sessionDigest.headline;

  const estimatedCost = calculateCost(
    session.provider,
    session.totalInputTokens,
    session.totalOutputTokens,
    session.totalCacheReadTokens
  );
  const estimatedCostFormatted = formatCost(estimatedCost, PROVIDER_CONFIGS[session.provider].tokenPricing.currency);

  return {
    session,
    patterns,
    totalWastedTokens,
    healthScore: scoreBreakdown.overall,
    scoreBreakdown,
    sessionSummary,
    sessionDigest,
    estimatedCost,
    estimatedCostFormatted,
  };
}

// ── Score computation ──────────────────────────────────────────────────────

function computeScoreBreakdown(
  session: SessionData,
  configMdContent: string,
  patterns: WastePattern[]
): ScoreBreakdown {
  const providerConfig = PROVIDER_CONFIGS[session.provider];

  let cacheEfficiency = 100;
  let cacheEfficiencyExp = "캐시 지원 안 함";
  if (providerConfig.supportsCache) {
    const totalInput = session.totalInputTokens + session.totalCacheReadTokens;
    const cacheHitRatio = totalInput > 0 ? session.totalCacheReadTokens / totalInput : 0;
    cacheEfficiency = Math.round(clamp(cacheHitRatio / 0.7, 0, 1) * 70 + 30);
    cacheEfficiencyExp = cacheHitRatio > 0.5
      ? `캐시 적중률(${(cacheHitRatio * 100).toFixed(1)}%)이 높습니다. 토큰을 효율적으로 아끼고 있습니다.`
      : cacheHitRatio > 0.2
      ? `캐시 적중률(${(cacheHitRatio * 100).toFixed(1)}%)이 보통입니다. 컨텍스트가 조금 더 안정적이면 좋겠습니다.`
      : `캐시 적중률이 낮습니다. 매번 컨텍스트를 새로 읽고 있어 비용이 발생합니다.`;
  }

  let toolSuccessRate = 100;
  let toolSuccessExp = "도구 지원 안 함";
  if (providerConfig.supportsTools) {
    const allToolResults = session.messages.filter(m => m.isToolResult);
    const errorResults = allToolResults.filter(m => m.isToolError);
    toolSuccessRate =
      allToolResults.length === 0
        ? 100
        : Math.round((1 - errorResults.length / allToolResults.length) * 100);
    toolSuccessExp = toolSuccessRate > 90
      ? "도구 호출이 거의 실패 없이 수행되었습니다."
      : toolSuccessRate > 70
      ? "일부 도구 실패가 있었으나 전반적으로 양호합니다."
      : `도구 실패율(${(100 - toolSuccessRate).toFixed(1)}%)이 높습니다. 지침을 보강하세요.`;
  }

  const totalTokens = session.totalInputTokens + session.totalOutputTokens;
  const outputRatio = totalTokens > 0 ? session.totalOutputTokens / totalTokens : 0;
  const contextDensity = Math.round(clamp((outputRatio - 0.05) / 0.1, 0, 1) * 100);
  const contextDensityExp = outputRatio > 0.15
    ? "입력 토큰 대비 생성된 답변의 양이 충분합니다."
    : outputRatio > 0.08
    ? "입력 토큰 대비 답변의 양이 적절합니다."
    : "입력 토큰 대비 답변이 너무 짧습니다. 컨텍스트가 너무 비대하거나 답변이 단편적입니다.";

  const configMdTokens = estimateTokens(configMdContent);
  const configMdHealth = Math.round(clamp(1 - configMdTokens / 3000, 0, 1) * 100);
  const configFileName = getConfigFileName(session.provider);
  const configMdExp = configMdTokens < 700
    ? `${configFileName} 상시 로딩 비용이 낮습니다 (~${configMdTokens} 토큰).`
    : configMdTokens < 1500
    ? `${configFileName} 상시 로딩 비용이 관리 가능한 수준입니다 (~${configMdTokens} 토큰).`
    : `${configFileName} 상시 로딩 비용이 큽니다 (~${configMdTokens} 토큰). 필수 지침은 유지하고, 상황별 지침은 필요할 때만 읽도록 분리하세요.`;

  const userMessages = session.messages.filter(m => m.role === "user" && isHumanVisibleMessage(m));
  const retryPattern = patterns.find(p => p.type === "RETRY_STORM");
  const retryEvidence = retryPattern && isRetryStormEvidence(retryPattern.evidence)
    ? retryPattern.evidence
    : null;
  const extraMessages = retryEvidence?.totalExtraMessages ?? 0;
  const retryRatio = userMessages.length > 0 ? extraMessages / userMessages.length : 0;
  const retryHealth = Math.round(clamp(1 - retryRatio / 0.2, 0, 1) * 100);
  const retryExp = extraMessages === 0
    ? "반복적인 요청이나 불필요한 재시도가 발견되지 않았습니다."
    : `${extraMessages}개의 반복 요청이 감지되었습니다. 같은 지점에서 헤매고 있을 가능성이 큽니다.`;

  const scopePattern = patterns.find(p => p.type === "SESSION_SCOPE_DRIFT");
  const phasePattern = patterns.find(p => p.type === "PHASE_MIXING");
  const actionPenalty =
    (scopePattern?.severity === "HIGH" ? 45 : scopePattern?.severity === "MEDIUM" ? 30 : scopePattern ? 15 : 0) +
    (phasePattern?.severity === "HIGH" ? 35 : phasePattern?.severity === "MEDIUM" ? 25 : phasePattern ? 15 : 0);
  const actionFocus = Math.round(clamp(100 - actionPenalty, 0, 100));
  const actionFocusExp = actionFocus >= 85
    ? "세션이 하나의 작업 흐름에 잘 집중되어 있습니다."
    : actionFocus >= 60
    ? "세션에 서로 다른 작업 흐름이 일부 섞였습니다. 다음부터는 큰 단계별로 세션을 나누는 편이 좋습니다."
    : "한 세션에서 기획, 구현, 검증 또는 여러 목적이 많이 섞였습니다. 세션을 역할별로 나누면 토큰 누적과 컨텍스트 혼선을 줄일 수 있습니다.";

  const cacheWeight = providerConfig.supportsCache ? 0.24 : 0;
  const toolWeight = providerConfig.supportsTools ? 0.22 : 0;
  const contextWeight = 0.18;
  const configMdWeight = 0.12;
  const retryWeight = 0.10;
  const actionWeight = 0.14;

  const totalWeight = cacheWeight + toolWeight + contextWeight + configMdWeight + retryWeight + actionWeight;
  const normalizedWeights = {
    cache: cacheWeight / totalWeight,
    tool: toolWeight / totalWeight,
    context: contextWeight / totalWeight,
    config: configMdWeight / totalWeight,
    retry: retryWeight / totalWeight,
    action: actionWeight / totalWeight,
  };

  const overall = Math.round(
    cacheEfficiency * normalizedWeights.cache +
    toolSuccessRate * normalizedWeights.tool +
    contextDensity * normalizedWeights.context +
    configMdHealth * normalizedWeights.config +
    retryHealth * normalizedWeights.retry +
    actionFocus * normalizedWeights.action
  );

  return {
    cacheEfficiency, toolSuccessRate, contextDensity, claudeMdHealth: configMdHealth, retryHealth, actionFocus, overall,
    explanations: {
      cacheEfficiency: cacheEfficiencyExp,
      toolSuccessRate: toolSuccessExp,
      contextDensity: contextDensityExp,
      claudeMdHealth: configMdExp,
      retryHealth: retryExp,
      actionFocus: actionFocusExp,
    }
  };
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

// ── Session summary ────────────────────────────────────────────────────────

function extractSessionDigest(messages: ParsedMessage[], score: ScoreBreakdown): SessionDigest {
  const userMessages = messages.filter(m => m.role === "user" && isHumanVisibleMessage(m) && m.contentText.trim().length > 5);

  if (userMessages.length === 0) {
    return {
      headline: "내용 없음",
      keyRequests: [],
      assistantActions: [],
      tokenAdvice: ["사용자 요청이 기록되지 않아 세션 효율을 판단하기 어렵습니다."],
    };
  }

  const workType = classifyWorkType(messages);
  const firstMsg = userMessages[0];
  const mainTask = firstMsg.contentText.trim().split("\n")[0].trim().slice(0, 70);
  const turns = userMessages.length;
  const suffix = turns > 1 ? ` (${turns}턴)` : "";
  const toolNames = summarizeToolNames(messages);
  const assistantActions = toolNames.length > 0
    ? [`사용 도구: ${toolNames.join(", ")}`]
    : ["도구 사용 없이 대화 중심으로 진행"];
  const keyRequests = userMessages.slice(0, 4).map((m, i) => {
    const text = m.contentText.trim().split("\n")[0].replace(/\s+/g, " ").slice(0, 90);
    return `${i + 1}. ${text}`;
  });
  const tokenAdvice = [
    score.actionFocus < 70 ? "다음에는 한 세션에 하나의 목적만 두고, 기획/구현/검증은 분리하세요." : "세션 목적 분리는 양호합니다.",
    score.contextDensity < 45 ? "입력 토큰 대비 출력이 적습니다. 요청 시 산출물 형식을 더 구체화하세요." : "입력 대비 산출 효율은 양호합니다.",
    score.retryHealth < 70 ? "반복 요청이 감지됩니다. 실패 조건과 중단 기준을 먼저 명시하세요." : "반복 요청 억제는 양호합니다.",
  ];

  return {
    headline: `[${workType}] ${mainTask}${suffix}`,
    keyRequests,
    assistantActions,
    tokenAdvice,
  };
}

function classifyWorkType(messages: ParsedMessage[]): string {
  const toolNames = messages
    .filter(m => m.isToolUse && m.toolName)
    .map(m => m.toolName!);

  const hasWrite  = toolNames.some(t => ["Write", "Edit", "MultiEdit", "apply_patch"].includes(t));
  const hasBash   = toolNames.some(t => t === "Bash" || t === "exec_command");
  const hasWeb    = toolNames.some(t => ["WebSearch", "WebFetch", "web.run"].includes(t));
  const hasRead   = toolNames.some(t => t === "Read" || t === "view_image");
  const hasAgent  = toolNames.some(t => t === "Agent" || t === "spawn_agent");

  const userText = messages
    .filter(m => m.role === "user" && isHumanVisibleMessage(m))
    .map(m => m.contentText.toLowerCase())
    .join(" ");

  const isDebug    = /에러|오류|버그|안 되|안되|fix|bug|error|debug|문제/.test(userText);
  const isRefactor = /리팩토링|refactor|개선|정리|cleanup/.test(userText);
  const isReview   = /리뷰|review|검토|코드 봐/.test(userText);

  if (isDebug && (hasWrite || hasBash)) return "디버깅";
  if (isRefactor && hasWrite)          return "리팩토링";
  if (isReview && hasRead)             return "코드 리뷰";
  if (hasWeb)                          return "리서치";
  if (hasWrite && hasBash)             return "코딩/실행";
  if (hasWrite)                        return "코딩";
  if (hasBash && !hasWrite)            return "실행/분석";
  if (hasRead && !hasWrite)            return "코드 분석";
  if (hasAgent)                        return "멀티에이전트";
  return "대화";
}

function summarizeToolNames(messages: ParsedMessage[]): string[] {
  const counts = new Map<string, number>();
  for (const m of messages) {
    if (m.isToolUse && m.toolName) counts.set(m.toolName, (counts.get(m.toolName) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([name, count]) => `${name} ${count}회`);
}

// ── Pattern detectors ──────────────────────────────────────────────────────

function detectContextBloat(configMdContent: string, provider: string): WastePattern | null {
  if (!configMdContent.trim()) return null;

  const sections = parseClaudeMd(configMdContent);
  const totalEstimatedTokens = estimateTokens(configMdContent);

  if (totalEstimatedTokens < CONTEXT_BLOAT_THRESHOLD) return null;

  const topOffenders = [...sections]
    .sort((a, b) => b.estimatedTokens - a.estimatedTokens)
    .slice(0, 3);

  const severity = totalEstimatedTokens > 4000 ? "HIGH" : totalEstimatedTokens > 2000 ? "MEDIUM" : "LOW";
  const configFileName = getConfigFileName(provider);

  return {
    type: "CONTEXT_BLOAT",
    severity,
    title: `${configFileName} 상시 로딩 비용 큼`,
    description: `${configFileName}가 매 요청마다 약 ${totalEstimatedTokens.toLocaleString()} 토큰을 차지합니다. 삭제가 아니라 필수 지침과 온디맨드 지침을 분리할 후보를 찾으세요.`,
    estimatedWastedTokens: Math.max(0, totalEstimatedTokens - CONTEXT_BLOAT_THRESHOLD),
    evidence: { sections, totalEstimatedTokens, topOffenders } as ContextBloatEvidence,
  };
}

function detectRetryStorm(messages: ParsedMessage[]): WastePattern | null {
  const userTextMessages = messages
    .filter(m => m.role === "user" && isHumanVisibleMessage(m) && m.contentText.trim().length > 20)
    .map(m => m.contentText.trim());

  const counts = new Map<string, number>();
  for (const text of userTextMessages) {
    counts.set(text, (counts.get(text) ?? 0) + 1);
  }

  const repeated = Array.from(counts.entries())
    .filter(([, count]) => count >= RETRY_STORM_MIN_REPEATS)
    .map(([text, count]) => ({ text, count }))
    .sort((a, b) => b.count - a.count);

  if (repeated.length === 0) return null;

  const totalExtraMessages = repeated.reduce((sum, r) => sum + (r.count - 1), 0);
  const estimatedWastedTokens = totalExtraMessages * 200;
  const severity = totalExtraMessages >= 10 ? "HIGH" : totalExtraMessages >= 5 ? "MEDIUM" : "LOW";

  return {
    type: "RETRY_STORM",
    severity,
    title: "반복 재시도 폭풍",
    description: `동일한 메시지가 ${RETRY_STORM_MIN_REPEATS}회 이상 반복되었습니다. 총 ${totalExtraMessages}개의 중복 메시지가 감지되었습니다.`,
    estimatedWastedTokens,
    evidence: { repeatedMessages: repeated, totalExtraMessages } as RetryStormEvidence,
  };
}

function detectToolThrash(messages: ParsedMessage[]): WastePattern[] {
  const patterns: WastePattern[] = [];

  let i = 0;
  while (i < messages.length) {
    const msg = messages[i];
    if (!msg.isToolUse || !msg.toolName) { i++; continue; }

    const toolName = msg.toolName;
    const run: number[] = [i];
    let j = i + 1;

    while (j < messages.length && messages[j].isToolUse && messages[j].toolName === toolName) {
      run.push(j);
      j++;
    }

    if (run.length >= TOOL_THRASH_MIN_CONSECUTIVE) {
      const errorRun = run.filter(idx => {
        const useId = messages[idx].toolUseId;
        return messages.some(m => m.isToolResult && m.toolUseId === useId && m.isToolError);
      });

      if (errorRun.length >= TOOL_THRASH_MIN_CONSECUTIVE) {
        const severity = errorRun.length >= 6 ? "HIGH" : errorRun.length >= 4 ? "MEDIUM" : "LOW";
        patterns.push({
          type: "TOOL_THRASH",
          severity,
          title: `도구 반복 실패: ${toolName}`,
          description: `"${toolName}" 도구가 연속으로 ${errorRun.length}회 오류와 함께 호출되었습니다.`,
          estimatedWastedTokens: (errorRun.length - 1) * 300,
          evidence: { toolName, consecutiveErrors: errorRun.length, messageIndices: errorRun } as ToolThrashEvidence,
        });
      }
    }

    i = j;
  }

  return patterns;
}

function detectSessionScopeDrift(messages: ParsedMessage[]): WastePattern | null {
  const workTypes = detectWorkTypes(messages);
  const userTurns = messages.filter(m => m.role === "user" && isHumanVisibleMessage(m)).length;

  if (workTypes.length <= 2 && userTurns <= 8) return null;

  const severity = workTypes.length >= 5 || userTurns >= 16 ? "HIGH" : workTypes.length >= 4 || userTurns >= 10 ? "MEDIUM" : "LOW";
  const estimatedWastedTokens = Math.max(0, (workTypes.length - 2) * 500 + Math.max(0, userTurns - 8) * 150);

  return {
    type: "SESSION_SCOPE_DRIFT",
    severity,
    title: "세션 범위 혼합",
    description: `한 세션에서 ${workTypes.join(", ")} 흐름이 함께 감지되었습니다. 무관한 작업을 섞으면 이전 컨텍스트가 계속 누적되어 입력 토큰이 커집니다.`,
    estimatedWastedTokens,
    evidence: {
      detectedWorkTypes: workTypes,
      userTurns,
      recommendation: "한 세션은 하나의 목적만 맡기고, 새 목적은 새 세션에서 시작하세요.",
    } as SessionScopeEvidence,
  };
}

function detectPhaseMixing(messages: ParsedMessage[]): WastePattern | null {
  const phases = detectWorkTypes(messages).filter(t => ["기획", "구현", "검증", "리뷰", "디버깅"].includes(t));
  const unique = Array.from(new Set(phases));

  if (!unique.includes("기획") || (!unique.includes("구현") && !unique.includes("디버깅"))) return null;

  const severity = unique.includes("검증") || unique.includes("리뷰") ? "MEDIUM" : "LOW";
  return {
    type: "PHASE_MIXING",
    severity,
    title: "기획/개발 단계 혼합",
    description: "기획과 구현이 같은 세션에서 이어졌습니다. 기획 세션의 넓은 맥락이 개발 단계까지 남아 토큰 효율이 떨어질 수 있습니다.",
    estimatedWastedTokens: severity === "MEDIUM" ? 900 : 500,
    evidence: {
      phases: unique,
      recommendation: "기획 산출물을 짧게 정리한 뒤 새 세션에서 구현만 지시하세요.",
    } as PhaseMixingEvidence,
  };
}

function detectWorkTypes(messages: ParsedMessage[]): string[] {
  const text = messages
    .filter(m => m.role === "user" && isHumanVisibleMessage(m))
    .map(m => m.contentText.toLowerCase())
    .join(" ");
  const toolNames = messages.filter(m => m.isToolUse && m.toolName).map(m => m.toolName!.toLowerCase());
  const types = new Set<string>();

  if (/기획|설계|plan|architecture|요구사항|전략/.test(text)) types.add("기획");
  if (/구현|개발|수정|만들|추가|implement|build|code/.test(text) || toolNames.some(t => /edit|write|apply_patch/.test(t))) types.add("구현");
  if (/테스트|검증|확인|verify|test|qa/.test(text) || toolNames.some(t => /test|playwright/.test(t))) types.add("검증");
  if (/리뷰|검토|review/.test(text)) types.add("리뷰");
  if (/에러|오류|버그|debug|fix|문제/.test(text)) types.add("디버깅");
  if (/문서|readme|docs|가이드/.test(text)) types.add("문서");
  if (/검색|조사|리서치|research|찾아/.test(text)) types.add("리서치");
  if (toolNames.some(t => /web|search|fetch/.test(t))) types.add("리서치");
  if (toolNames.some(t => /spawn_agent|agent/.test(t))) types.add("멀티에이전트");

  return Array.from(types);
}

function getConfigFileName(provider: string): string {
  if (provider === "gemini") return "GEMINI.md";
  if (provider === "codex") return "AGENTS.md";
  return "CLAUDE.md";
}

export function isContextBloatEvidence(e: WasteEvidence): e is ContextBloatEvidence {
  return "sections" in e;
}

export function isRetryStormEvidence(e: WasteEvidence): e is RetryStormEvidence {
  return "repeatedMessages" in e;
}

export function isToolThrashEvidence(e: WasteEvidence): e is ToolThrashEvidence {
  return "toolName" in e;
}

export function isSessionScopeEvidence(e: WasteEvidence): e is SessionScopeEvidence {
  return "detectedWorkTypes" in e;
}

export function isPhaseMixingEvidence(e: WasteEvidence): e is PhaseMixingEvidence {
  return "phases" in e;
}
