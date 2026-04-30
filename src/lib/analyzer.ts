import { ParsedMessage, SessionData, ClaudeSection, parseClaudeMd, estimateTokens } from "./parser";
import { PROVIDER_CONFIGS, calculateCost, formatCost } from "./providers";

export type WastePatternType = "CONTEXT_BLOAT" | "RETRY_STORM" | "TOOL_THRASH";

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

export type WasteEvidence = ContextBloatEvidence | RetryStormEvidence | ToolThrashEvidence;

export interface ScoreBreakdown {
  cacheEfficiency: number;   // 0-100
  toolSuccessRate: number;   // 0-100
  contextDensity: number;    // 0-100
  claudeMdHealth: number;    // 0-100: CLAUDE.md/GEMINI.md health
  retryHealth: number;       // 0-100
  overall: number;           // weighted avg
  explanations: {
    cacheEfficiency: string;
    toolSuccessRate: string;
    contextDensity: string;
    claudeMdHealth: string;
    retryHealth: string;
  };
}

export interface DiagnosticResult {
  session: SessionData;
  patterns: WastePattern[];
  totalWastedTokens: number;
  healthScore: number;
  scoreBreakdown: ScoreBreakdown;
  sessionSummary: string;
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

  const totalWastedTokens = patterns.reduce((sum, p) => sum + p.estimatedWastedTokens, 0);
  const scoreBreakdown = computeScoreBreakdown(session, configMdContent, patterns);
  const sessionSummary = extractSessionSummary(session.messages);

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
  const configFileName = session.provider === "gemini" ? "GEMINI.md" : "CLAUDE.md";
  const configMdExp = configMdTokens < 700
    ? `${configFileName}가 매우 가볍습니다 (~${configMdTokens} 토큰).`
    : configMdTokens < 1500
    ? `${configFileName} 크기가 적당합니다 (~${configMdTokens} 토큰).`
    : `${configFileName}가 무겁습니다 (~${configMdTokens} 토큰). 불필요한 내용을 정리하면 매 요청마다 토큰을 아낄 수 있습니다.`;

  const userMessages = session.messages.filter(m => m.role === "user" && !m.isToolResult);
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

  const cacheWeight = providerConfig.supportsCache ? 0.30 : 0;
  const toolWeight = providerConfig.supportsTools ? 0.25 : 0;
  const contextWeight = 0.20;
  const configMdWeight = 0.15;
  const retryWeight = 0.10;

  const totalWeight = cacheWeight + toolWeight + contextWeight + configMdWeight + retryWeight;
  const normalizedWeights = {
    cache: cacheWeight / totalWeight,
    tool: toolWeight / totalWeight,
    context: contextWeight / totalWeight,
    config: configMdWeight / totalWeight,
    retry: retryWeight / totalWeight,
  };

  const overall = Math.round(
    cacheEfficiency * normalizedWeights.cache +
    toolSuccessRate * normalizedWeights.tool +
    contextDensity * normalizedWeights.context +
    configMdHealth * normalizedWeights.config +
    retryHealth * normalizedWeights.retry
  );

  return {
    cacheEfficiency, toolSuccessRate, contextDensity, claudeMdHealth: configMdHealth, retryHealth, overall,
    explanations: {
      cacheEfficiency: cacheEfficiencyExp,
      toolSuccessRate: toolSuccessExp,
      contextDensity: contextDensityExp,
      claudeMdHealth: configMdExp,
      retryHealth: retryExp,
    }
  };
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

// ── Session summary ────────────────────────────────────────────────────────

function extractSessionSummary(messages: ParsedMessage[]): string {
  const userMessages = messages.filter(
    m => m.role === "user" && !m.isToolResult && m.contentText.trim().length > 5
  );

  if (userMessages.length === 0) return "내용 없음";

  const workType = classifyWorkType(messages);
  const firstMsg = userMessages[0];
  const mainTask = firstMsg.contentText.trim().split("\n")[0].trim().slice(0, 70);
  const turns = userMessages.length;
  const suffix = turns > 1 ? ` (${turns}턴)` : "";

  return `[${workType}] ${mainTask}${suffix}`;
}

function classifyWorkType(messages: ParsedMessage[]): string {
  const toolNames = messages
    .filter(m => m.isToolUse && m.toolName)
    .map(m => m.toolName!);

  const hasWrite  = toolNames.some(t => ["Write", "Edit", "MultiEdit"].includes(t));
  const hasBash   = toolNames.some(t => t === "Bash");
  const hasWeb    = toolNames.some(t => ["WebSearch", "WebFetch"].includes(t));
  const hasRead   = toolNames.some(t => t === "Read");
  const hasAgent  = toolNames.some(t => t === "Agent");

  const userText = messages
    .filter(m => m.role === "user" && !m.isToolResult)
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
  const configFileName = provider === "gemini" ? "GEMINI.md" : "CLAUDE.md";

  return {
    type: "CONTEXT_BLOAT",
    severity,
    title: `${configFileName} 컨텍스트 과부하`,
    description: `${configFileName}가 매 요청마다 약 ${totalEstimatedTokens.toLocaleString()} 토큰을 소모합니다. 불필요한 섹션을 제거하거나 간결하게 압축하세요.`,
    estimatedWastedTokens: Math.max(0, totalEstimatedTokens - CONTEXT_BLOAT_THRESHOLD),
    evidence: { sections, totalEstimatedTokens, topOffenders } as ContextBloatEvidence,
  };
}

function detectRetryStorm(messages: ParsedMessage[]): WastePattern | null {
  const userTextMessages = messages
    .filter(m => m.role === "user" && m.contentText.trim().length > 20 && !m.isToolResult)
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

export function isContextBloatEvidence(e: WasteEvidence): e is ContextBloatEvidence {
  return "sections" in e;
}

export function isRetryStormEvidence(e: WasteEvidence): e is RetryStormEvidence {
  return "repeatedMessages" in e;
}

export function isToolThrashEvidence(e: WasteEvidence): e is ToolThrashEvidence {
  return "toolName" in e;
}
