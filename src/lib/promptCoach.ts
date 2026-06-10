import { DiagnosticResult } from "./analyzer";
import { isHumanVisibleMessage } from "./parser";

export type PromptQuestionCandidateKind = "recent" | "inefficient" | "broad";

export interface PromptQuestionCandidate {
  id: string;
  kind: PromptQuestionCandidateKind;
  label: string;
  question: string;
  reason: string;
  improvement: string;
  score: number;
  estimatedSavedTokens: number;
}

export interface PromptCoachRequest {
  question: string;
  session_summary?: string;
  project?: string;
  provider?: string;
  patterns: string[];
  recent_user_messages: string[];
  score_breakdown: Record<string, number>;
  ambiguity_reason?: string;
  expected_improvement?: string;
  estimated_saved_tokens?: number;
  candidate_score?: number;
}

export interface PromptCoachResponse {
  advice: string;
}

export interface DraftPromptAssessment {
  summary: string;
  ambiguityReason: string;
  expectedImprovement: string;
  score: number;
  estimatedSavedTokens: number;
}

export function assessDraftQuestion(question: string): DraftPromptAssessment {
  const trimmed = question.trim();
  const score = scoreQuestionText(trimmed, 70, 50);
  const reasons = buildQuestionReasons(trimmed);
  const improvements = buildQuestionImprovements(trimmed, 65);

  return {
    summary: summarizeDraftQuestion(trimmed),
    ambiguityReason: reasons.join(" ") || "큰 모호성은 적지만, 산출물 형식과 완료 조건을 더 명시하면 좋습니다.",
    expectedImprovement: improvements.join(", ") || "질문의 목적과 산출물 형식을 더 명확히 함",
    score,
    estimatedSavedTokens: estimateSavedTokensFromScore(trimmed, score, 65),
  };
}

export function buildDraftPromptCoachRequest(question: string): PromptCoachRequest {
  const assessment = assessDraftQuestion(question);

  return {
    question,
    session_summary: "사용자가 AI에게 보내기 전 초안 질문을 TokenScope 질문 리팩토링기에서 점검 중입니다.",
    project: "draft-question",
    provider: "codex",
    patterns: [
      `DRAFT_PROMPT_REFACTOR: ${assessment.ambiguityReason}`,
    ],
    recent_user_messages: [question],
    ambiguity_reason: assessment.ambiguityReason,
    expected_improvement: assessment.expectedImprovement,
    estimated_saved_tokens: assessment.estimatedSavedTokens,
    candidate_score: assessment.score,
    score_breakdown: {
      overall: Math.max(0, 100 - assessment.score),
      actionFocus: /그리고|또|추가로|동시에|한번에/i.test(question) ? 55 : 75,
      contextDensity: question.length > 180 ? 45 : 65,
      cacheEfficiency: 70,
      toolSuccessRate: 80,
      configHealth: 75,
      retryHealth: 75,
    },
  };
}

export function buildPromptQuestionCandidates(diagnostic: DiagnosticResult): PromptQuestionCandidate[] {
  const userMessages = diagnostic.session.messages
    .filter(message => message.role === "user" && isHumanVisibleMessage(message))
    .map((message, index) => ({
      id: `message-${index}`,
      text: message.contentText.trim(),
      timestamp: message.timestamp,
    }))
    .filter(message => message.text.length > 0);

  const candidates: PromptQuestionCandidate[] = [];
  const last = userMessages[userMessages.length - 1];

  if (last) {
    candidates.push({
      id: "recent",
      kind: "recent",
      label: "가장 최근 질문",
      question: last.text,
      reason: "방금 한 요청을 바로 다음 요청으로 고치기 좋습니다.",
      improvement: buildImprovementSummary(last.text, diagnostic),
      score: scoreQuestion(last.text, diagnostic),
      estimatedSavedTokens: estimateSavedTokens(last.text, diagnostic),
    });
  }

  const broadRequests = diagnostic.patterns
    .filter(pattern => pattern.type === "BROAD_REQUEST" && "requests" in pattern.evidence)
    .flatMap(pattern => {
      const evidence = pattern.evidence as { requests: { original: string; reason: string }[] };
      return evidence.requests.map((request, index) => {
        const question = findOriginalQuestion(userMessages.map(message => message.text), request.original);
        return {
        id: `broad-${index}`,
        kind: "broad" as const,
        label: `모호한 질문 ${index + 1}`,
        question,
        reason: request.reason,
        improvement: buildImprovementSummary(question, diagnostic),
        score: 95 - index,
        estimatedSavedTokens: estimateSavedTokens(question, diagnostic),
      };
      });
    });

  candidates.push(...broadRequests);

  const inefficient = [...userMessages]
    .map(message => ({
      id: `inefficient-${message.id}`,
      kind: "inefficient" as const,
      label: "효율이 낮아 보이는 질문",
      question: message.text,
      reason: buildInefficiencyReason(message.text, diagnostic),
      improvement: buildImprovementSummary(message.text, diagnostic),
      score: scoreQuestion(message.text, diagnostic),
      estimatedSavedTokens: estimateSavedTokens(message.text, diagnostic),
    }))
    .sort((a, b) => b.score - a.score)
    .find(candidate => candidate.score >= 45);

  if (inefficient) candidates.push(inefficient);

  return dedupeCandidates(candidates)
    .sort((a, b) => {
      const order = { broad: 0, inefficient: 1, recent: 2 };
      return order[a.kind] - order[b.kind] || b.score - a.score;
    })
    .slice(0, 4);
}

export function buildPromptCoachRequest(
  diagnostic: DiagnosticResult,
  question: string,
  candidate?: PromptQuestionCandidate | null
): PromptCoachRequest {
  const recentUserMessages = diagnostic.session.messages
    .filter(message => message.role === "user" && isHumanVisibleMessage(message))
    .map(message => message.contentText.trim())
    .filter(Boolean)
    .slice(-5);

  return {
    question,
    session_summary: diagnostic.sessionSummary,
    project: diagnostic.session.project,
    provider: diagnostic.session.provider,
    patterns: diagnostic.patterns.map(pattern =>
      `${pattern.severity} ${pattern.type}: ${pattern.title} - ${pattern.description}`
    ),
    recent_user_messages: recentUserMessages,
    ambiguity_reason: candidate?.reason,
    expected_improvement: candidate?.improvement,
    estimated_saved_tokens: candidate?.estimatedSavedTokens,
    candidate_score: candidate?.score,
    score_breakdown: {
      cacheEfficiency: diagnostic.scoreBreakdown.cacheEfficiency,
      toolSuccessRate: diagnostic.scoreBreakdown.toolSuccessRate,
      contextDensity: diagnostic.scoreBreakdown.contextDensity,
      configHealth: diagnostic.scoreBreakdown.claudeMdHealth,
      retryHealth: diagnostic.scoreBreakdown.retryHealth,
      actionFocus: diagnostic.scoreBreakdown.actionFocus,
      overall: diagnostic.scoreBreakdown.overall,
    },
  };
}

export async function requestPromptCoach(payload: PromptCoachRequest): Promise<PromptCoachResponse> {
  const response = await fetch("http://127.0.0.1:8000/coach-prompt", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(text || `Prompt coach request failed: ${response.status}`);
  }

  return response.json();
}

function scoreQuestion(question: string, diagnostic: DiagnosticResult): number {
  return scoreQuestionText(
    question,
    diagnostic.scoreBreakdown.actionFocus,
    diagnostic.scoreBreakdown.contextDensity
  );
}

function buildInefficiencyReason(question: string, diagnostic: DiagnosticResult): string {
  const reasons = buildQuestionReasons(question);
  if (diagnostic.scoreBreakdown.actionFocus < 70) {
    reasons.push("현재 세션 집중도 점수가 낮아 질문을 더 작게 나누는 편이 좋습니다.");
  }
  return reasons[0] ?? "TokenScope 점수 기준으로 다음 요청에서 개선 여지가 큽니다.";
}

function buildImprovementSummary(question: string, diagnostic: DiagnosticResult): string {
  const improvements = buildQuestionImprovements(question, diagnostic.scoreBreakdown.actionFocus);
  if (diagnostic.scoreBreakdown.actionFocus < 70) {
    improvements.push("기획/구현/검증을 한 번에 섞지 않도록 단계 분리");
  }
  return improvements.join(", ") || "질문의 목적과 산출물 형식을 더 명확히 함";
}

function estimateSavedTokens(question: string, diagnostic: DiagnosticResult): number {
  const score = scoreQuestion(question, diagnostic);
  return estimateSavedTokensFromScore(question, score, diagnostic.scoreBreakdown.actionFocus);
}

function scoreQuestionText(question: string, actionFocus: number, contextDensity: number): number {
  const text = question.toLowerCase();
  let score = 0;

  if (/(전체적으로|전반적으로|알아서|좋게|봐줘|해봐|문제 있으면|이상한 부분|개선해줘|고쳐줘)/i.test(question)) score += 42;
  if (question.length > 180) score += 18;
  if (question.length < 18) score += 16;
  if (!hasScopeMarkers(question)) score += 18;
  if (/(그리고|또|추가로|겸사|동시에|한번에|as well as|also)/i.test(question)) score += 10;
  if (actionFocus < 70) score += 8;
  if (contextDensity < 45) score += 8;
  if (text.includes("readme") && text.includes("실행") && text.includes("에러")) score += 6;

  return Math.min(100, score);
}

function buildQuestionReasons(question: string): string[] {
  const reasons: string[] = [];
  if (/(전체적으로|전반적으로|알아서|좋게|봐줘|해봐|문제 있으면|이상한 부분|개선해줘|고쳐줘)/i.test(question)) {
    reasons.push("범위가 넓은 표현이 있어 작업 단위가 커질 수 있습니다.");
  }
  if (!hasScopeMarkers(question)) {
    reasons.push("대상, 완료 조건, 제외 범위가 부족합니다.");
  }
  if (/(그리고|또|추가로|겸사|동시에|한번에|as well as|also)/i.test(question)) {
    reasons.push("여러 목적이 한 요청에 섞여 세션이 길어질 수 있습니다.");
  }
  if (question.length < 18) {
    reasons.push("질문이 너무 짧아 AI가 작업 맥락을 추측해야 합니다.");
  }
  return reasons;
}

function buildQuestionImprovements(question: string, actionFocus: number): string[] {
  const improvements: string[] = [];
  if (!hasScopeMarkers(question)) {
    improvements.push("대상과 완료 조건을 넣어 탐색 범위를 줄임");
  }
  if (/(전체적으로|전반적으로|알아서|좋게|봐줘|해봐|문제 있으면|이상한 부분|개선해줘|고쳐줘)/i.test(question)) {
    improvements.push("모호한 표현을 구체적인 작업 지시로 바꿈");
  }
  if (actionFocus < 70) {
    improvements.push("작업 단계를 분리해 누적 컨텍스트를 줄임");
  }
  return improvements;
}

function estimateSavedTokensFromScore(question: string, score: number, actionFocus: number): number {
  const base = Math.round(score * 12);
  const broadBonus = /(전체적으로|전반적으로|알아서|좋게|봐줘|해봐|문제 있으면|이상한 부분|개선해줘|고쳐줘)/i.test(question) ? 350 : 0;
  const focusBonus = actionFocus < 70 ? 250 : 0;
  return Math.max(120, Math.min(1800, base + broadBonus + focusBonus));
}

function hasScopeMarkers(question: string): boolean {
  return /(파일|화면|함수|테스트|검증|완료 조건|범위|하지 마|수정하지 마|먼저|결과|산출물|file|test|verify|scope|criteria|result|output)/i.test(question);
}

function summarizeDraftQuestion(question: string): string {
  const firstLine = question.replace(/\s+/g, " ").trim();
  if (!firstLine) return "";
  if (firstLine.length <= 80) return firstLine;
  return `${firstLine.slice(0, 79)}…`;
}

function findOriginalQuestion(questions: string[], excerpt: string): string {
  const normalizedExcerpt = normalizeText(excerpt).slice(0, 80);
  return questions.find(question => normalizeText(question).includes(normalizedExcerpt)) ?? excerpt;
}

function dedupeCandidates(candidates: PromptQuestionCandidate[]): PromptQuestionCandidate[] {
  const seen = new Set<string>();
  const result: PromptQuestionCandidate[] = [];

  for (const candidate of candidates) {
    const key = normalizeText(candidate.question).slice(0, 120);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(candidate);
  }

  return result;
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}
