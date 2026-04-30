import { WastePattern, DiagnosticResult, isContextBloatEvidence, isRetryStormEvidence, isToolThrashEvidence } from "./analyzer";
import { ClaudeSection, estimateTokens } from "./parser";
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
  };
}

export type FixAction =
  | { kind: "edit_config_md"; provider: string; originalContent: string; suggestedContent: string; diff: DiffLine[] }
  | { kind: "info"; steps: string[] };

export interface DiffLine {
  type: "context" | "removed" | "added";
  content: string;
}

export function prescribe(result: DiagnosticResult, configMdContent: string): Fix[] {
  return result.patterns.map(p => prescribePattern(p, configMdContent, result)).filter((f): f is Fix => f !== null);
}

function prescribePattern(pattern: WastePattern, configMdContent: string, result: DiagnosticResult): Fix | null {
  switch (pattern.type) {
    case "CONTEXT_BLOAT":
      return prescribeContextBloat(pattern, configMdContent, result);
    case "RETRY_STORM":
      return prescribeRetryStorm(pattern, result.session.provider);
    case "TOOL_THRASH":
      return prescribeToolThrash(pattern, result.session.provider);
    default:
      return null;
  }
}

function prescribeContextBloat(pattern: WastePattern, configMdContent: string, result: DiagnosticResult): Fix {
  const evidence = pattern.evidence;
  const provider = result.session.provider;
  const configFileName = provider === "gemini" ? "GEMINI.md" : "CLAUDE.md";

  if (!isContextBloatEvidence(evidence)) {
    return buildInfoFix(pattern, [`${configFileName} 내용을 검토하고 불필요한 섹션을 제거하세요.`]);
  }

  const { topOffenders } = evidence;
  const trimmed = trimConfigMd(configMdContent, topOffenders);
  const diff = buildDiff(configMdContent, trimmed);

  const beforeTokens = estimateTokens(configMdContent);
  const afterTokens = estimateTokens(trimmed);
  const msgCount = Math.max(1, result.session.messages.length);
  const beforeTotal = beforeTokens * msgCount;
  const afterTotal = afterTokens * msgCount;
  const savedTokens = beforeTotal - afterTotal;
  const savedPercentage = beforeTotal > 0 ? Math.round((savedTokens / beforeTotal) * 100) : 0;

  const savedCost = calculateCost(provider, savedTokens, 0, 0);
  const savedCostFormatted = formatCost(savedCost, PROVIDER_CONFIGS[provider].tokenPricing.currency);

  return {
    patternType: "CONTEXT_BLOAT",
    title: `${configFileName} 슬림화`,
    description: `가장 무거운 ${topOffenders.length}개 섹션을 압축하거나 제거합니다.`,
    action: {
      kind: "edit_config_md",
      provider,
      originalContent: configMdContent,
      suggestedContent: trimmed,
      diff,
    },
    beforeAfterComparison: {
      beforeTokens: beforeTotal,
      afterTokens: afterTotal,
      savedTokens,
      savedPercentage,
      savedCost,
      savedCostFormatted,
    },
  };
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
        result.push("# [이 섹션은 토큰 절약을 위해 압축되었습니다. 내용을 검토하고 핵심만 남기세요.]");
      }
    } else {
      result.push(line);
    }
  }

  return result.join("\n");
}

function prescribeRetryStorm(pattern: WastePattern, provider: string): Fix {
  const evidence = pattern.evidence;
  const configFileName = provider === "gemini" ? "GEMINI.md" : "CLAUDE.md";

  if (!isRetryStormEvidence(evidence)) {
    return buildInfoFix(pattern, ["반복 요청 패턴을 검토하세요."]);
  }

  const steps = [
    `감지된 반복 메시지 ${evidence.repeatedMessages.length}개:`,
    ...evidence.repeatedMessages.slice(0, 3).map(
      r => `  • "${r.text.slice(0, 60)}${r.text.length > 60 ? "..." : ""}" (${r.count}회 반복)`
    ),
    "",
    "권장 조치:",
    `1. ${configFileName}에 해당 작업에 대한 명확한 지침을 추가하세요.`,
    "2. 에러 발생 시 다른 전략을 시도하도록 유도하는 문구를 추가하세요.",
    '예시: "작업이 3회 실패하면 다른 접근법을 사용하세요."',
  ];

  return buildInfoFix(pattern, steps);
}

function prescribeToolThrash(pattern: WastePattern, provider: string): Fix {
  const evidence = pattern.evidence;
  const configFileName = provider === "gemini" ? "GEMINI.md" : "CLAUDE.md";

  if (!isToolThrashEvidence(evidence)) {
    return buildInfoFix(pattern, ["도구 사용 패턴을 검토하세요."]);
  }

  const steps = [
    `"${evidence.toolName}" 도구가 연속 ${evidence.consecutiveErrors}회 실패했습니다.`,
    "",
    "권장 조치:",
    `1. ${configFileName}에 "${evidence.toolName}" 실패 시 대체 전략을 명시하세요.`,
    "2. 동일 도구를 3회 이상 재시도하지 않도록 지침을 추가하세요.",
    `예시: "같은 도구로 3회 실패 시 다른 방법을 시도하거나 사용자에게 보고하세요."`,
  ];

  return buildInfoFix(pattern, steps);
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
