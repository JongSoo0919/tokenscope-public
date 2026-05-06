import {
  DiagnosticResult,
  WastePattern,
  isBroadRequestEvidence,
  isContextBloatEvidence,
  isPhaseMixingEvidence,
  isRetryStormEvidence,
  isSessionScopeEvidence,
  isToolThrashEvidence,
} from "../lib/analyzer";
import { ParsedMessage, isHumanVisibleMessage } from "../lib/parser";

interface Props {
  diagnostic: DiagnosticResult;
}

interface TimelineItem {
  message: ParsedMessage;
  index: number;
  issues: MessageIssue[];
}

interface MessageIssue {
  title: string;
  detail: string;
  severity: WastePattern["severity"];
  suggestion?: string;
}

export function ConversationReview({ diagnostic }: Props) {
  const globalIssues = buildGlobalIssues(diagnostic);
  const timeline = buildTimeline(diagnostic);

  return (
    <>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title">이 대화에서 잘못된 점</div>
        {diagnostic.patterns.length === 0 ? (
          <div style={{ color: "var(--green)", fontSize: 12, lineHeight: 1.5 }}>
            이 세션에서는 대화 단위로 설명할 만한 낭비 패턴이 발견되지 않았습니다.
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
            {diagnostic.patterns.map(pattern => (
              <IssueCard
                key={`${pattern.type}-${pattern.title}`}
                title={pattern.title}
                detail={pattern.description}
                severity={pattern.severity}
                footer={`낭비 추정 ${pattern.estimatedWastedTokens.toLocaleString("ko-KR")} 토큰`}
              />
            ))}
          </div>
        )}
      </div>

      {globalIssues.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-title">세션 전체 문제</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {globalIssues.map((issue, i) => (
              <IssueCard key={i} {...issue} />
            ))}
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-title">대화 기록</div>
        {timeline.length === 0 ? (
          <div style={{ color: "var(--muted)", fontSize: 12 }}>표시할 대화 메시지가 없습니다.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {timeline.map(item => (
              <MessageRow key={`${item.message.uuid}-${item.index}`} item={item} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function buildTimeline(diagnostic: DiagnosticResult): TimelineItem[] {
  const issueMap = new Map<number, MessageIssue[]>();

  for (const pattern of diagnostic.patterns) {
    if (isBroadRequestEvidence(pattern.evidence)) {
      for (const request of pattern.evidence.requests) {
        diagnostic.session.messages.forEach((message, index) => {
          if (message.role !== "user" || !isHumanVisibleMessage(message)) return;
          if (!sameCompactText(message.contentText, request.original)) return;
          pushIssue(issueMap, index, {
            title: "요청 범위가 넓음",
            detail: request.reason,
            severity: pattern.severity,
            suggestion: request.improved,
          });
        });
      }
    }

    if (isRetryStormEvidence(pattern.evidence)) {
      for (const repeated of pattern.evidence.repeatedMessages) {
        diagnostic.session.messages.forEach((message, index) => {
          if (message.role !== "user" || !isHumanVisibleMessage(message)) return;
          if (compact(message.contentText) !== compact(repeated.text)) return;
          pushIssue(issueMap, index, {
            title: "같은 요청 반복",
            detail: `같은 메시지가 ${repeated.count}회 반복되어 이전 실패 맥락이 계속 누적되었습니다.`,
            severity: pattern.severity,
          });
        });
      }
    }

    if (isToolThrashEvidence(pattern.evidence)) {
      for (const index of pattern.evidence.messageIndices) {
        pushIssue(issueMap, index, {
          title: "도구 실패 반복",
          detail: `${pattern.evidence.toolName} 도구가 연속 ${pattern.evidence.consecutiveErrors}회 실패했습니다.`,
          severity: pattern.severity,
          suggestion: "같은 도구가 3회 실패하면 원인을 요약하고 다른 접근으로 전환하도록 지시하는 편이 좋습니다.",
        });
      }
    }
  }

  return diagnostic.session.messages
    .map((message, index) => ({ message, index, issues: issueMap.get(index) ?? [] }))
    .filter(item => shouldShowMessage(item.message, item.issues));
}

function buildGlobalIssues(diagnostic: DiagnosticResult): MessageIssue[] {
  return diagnostic.patterns.flatMap(pattern => {
    if (isContextBloatEvidence(pattern.evidence)) {
      const offenders = pattern.evidence.topOffenders
        .map(section => `${section.heading} ${section.estimatedTokens.toLocaleString("ko-KR")}토큰`)
        .join(", ");
      return [{
        title: "대화 시작 전 컨텍스트가 큼",
        detail: `상시 지침이 약 ${pattern.evidence.totalEstimatedTokens.toLocaleString("ko-KR")}토큰입니다. 큰 섹션: ${offenders}`,
        severity: pattern.severity,
        suggestion: "항상 필요한 규칙만 남기고, 작업별 긴 절차는 별도 문서나 Skill로 분리하세요.",
      }];
    }

    if (isSessionScopeEvidence(pattern.evidence)) {
      return [{
        title: "한 세션에 작업 종류가 섞임",
        detail: `${pattern.evidence.detectedWorkTypes.join(", ")} 흐름이 ${pattern.evidence.userTurns}턴 안에 함께 감지되었습니다.`,
        severity: pattern.severity,
        suggestion: pattern.evidence.recommendation,
      }];
    }

    if (isPhaseMixingEvidence(pattern.evidence)) {
      return [{
        title: "기획과 실행 단계가 이어짐",
        detail: `${pattern.evidence.phases.join(", ")} 단계가 같은 세션에 남아 있습니다.`,
        severity: pattern.severity,
        suggestion: pattern.evidence.recommendation,
      }];
    }

    return [];
  });
}

function MessageRow({ item }: { item: TimelineItem }) {
  const { message, index, issues } = item;
  const roleLabel = message.isToolUse
    ? "도구 호출"
    : message.isToolResult
    ? "도구 결과"
    : message.role === "user"
    ? "사용자"
    : "AI";
  const accent = issues.length > 0 ? severityColor(issues[0].severity) : "var(--border)";
  const content = message.contentText.trim() || (message.toolName ? `${message.toolName} 호출` : "(내용 없음)");

  return (
    <div style={{ border: `1px solid ${issues.length > 0 ? accent : "var(--border)"}`, borderLeft: `3px solid ${accent}`, borderRadius: 6, padding: 12, background: "var(--surface2)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", marginBottom: 8 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", minWidth: 0 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: message.role === "user" ? "var(--accent)" : "var(--green)" }}>
            {roleLabel}
          </span>
          {message.toolName && (
            <span style={{ fontSize: 10, color: "var(--muted)", border: "1px solid var(--border)", borderRadius: 999, padding: "2px 7px" }}>
              {message.toolName}
            </span>
          )}
          {message.isToolError && <span style={{ fontSize: 10, color: "var(--red)" }}>실패</span>}
        </div>
        <span style={{ fontSize: 10, color: "var(--muted)", flexShrink: 0 }}>#{index + 1}</span>
      </div>

      <div style={{ fontSize: 12, lineHeight: 1.55, whiteSpace: "pre-wrap", wordBreak: "break-word", color: "var(--text)", maxHeight: 220, overflow: "auto" }}>
        {content.length > 1600 ? `${content.slice(0, 1600)}...` : content}
      </div>

      {issues.length > 0 && (
        <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
          {issues.map((issue, i) => (
            <IssueCard key={i} {...issue} compact />
          ))}
        </div>
      )}
    </div>
  );
}

function IssueCard({
  title,
  detail,
  severity,
  suggestion,
  footer,
  compact: isCompact = false,
}: MessageIssue & { footer?: string; compact?: boolean }) {
  return (
    <div style={{ borderLeft: `3px solid ${severityColor(severity)}`, background: "rgba(15, 17, 23, 0.35)", borderRadius: 6, padding: isCompact ? "8px 10px" : 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginBottom: 5 }}>
        <span style={{ fontSize: 12, fontWeight: 700 }}>{title}</span>
        <span className={`badge ${severity}`}>{severity}</span>
      </div>
      <div style={{ fontSize: 11, color: "var(--muted)", lineHeight: 1.5 }}>{detail}</div>
      {suggestion && (
        <div style={{ marginTop: 7, fontSize: 11, color: "var(--text)", lineHeight: 1.45 }}>
          다음에는: {suggestion}
        </div>
      )}
      {footer && <div style={{ marginTop: 7, fontSize: 11, color: "var(--accent)" }}>{footer}</div>}
    </div>
  );
}

function shouldShowMessage(message: ParsedMessage, issues: MessageIssue[]): boolean {
  if (isHumanVisibleMessage(message)) return true;
  if (issues.length > 0) return true;
  if (message.isToolResult && message.isToolError) return true;
  return false;
}

function pushIssue(map: Map<number, MessageIssue[]>, index: number, issue: MessageIssue) {
  map.set(index, [...(map.get(index) ?? []), issue]);
}

function sameCompactText(messageText: string, evidenceText: string): boolean {
  const message = compact(messageText);
  const evidence = compact(evidenceText).replace(/…$/, "");
  return message === evidence || message.startsWith(evidence) || evidence.startsWith(message.slice(0, 120));
}

function compact(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function severityColor(severity: WastePattern["severity"]): string {
  if (severity === "HIGH") return "var(--red)";
  if (severity === "MEDIUM") return "var(--orange)";
  return "var(--yellow)";
}
