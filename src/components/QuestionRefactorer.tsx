import { useMemo, useState } from "react";
import {
  assessDraftQuestion,
  buildDraftPromptCoachRequest,
  requestPromptCoach,
} from "../lib/promptCoach";

export function QuestionRefactorer() {
  const [question, setQuestion] = useState("");
  const [advice, setAdvice] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const assessment = useMemo(() => {
    const trimmed = question.trim();
    return trimmed ? assessDraftQuestion(trimmed) : null;
  }, [question]);

  const sections = useMemo(() => parseCoachAdvice(advice), [advice]);

  const runRefactor = async () => {
    const trimmed = question.trim();
    if (!trimmed) {
      setError("먼저 리팩토링할 질문을 입력하세요.");
      return;
    }

    setLoading(true);
    setError(null);
    setAdvice("");
    try {
      const response = await requestPromptCoach(buildDraftPromptCoachRequest(trimmed));
      setAdvice(response.advice);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card">
      <div className="card-title">질문 리팩토링기</div>
      <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.6, marginBottom: 12 }}>
        AI에게 보내기 전 질문을 먼저 넣으면, 모호한 지점을 점검하고 바로 복사할 수 있는 질문으로 다듬습니다.
      </div>

      <textarea
        value={question}
        onChange={event => {
          setQuestion(event.target.value);
          setAdvice("");
          setError(null);
        }}
        placeholder="예: 이거 전체적으로 봐서 좋게 고쳐줘"
        style={{
          width: "100%",
          minHeight: 112,
          resize: "vertical",
          borderRadius: 6,
          border: "1px solid var(--border)",
          background: "var(--surface2)",
          color: "var(--text)",
          padding: 12,
          lineHeight: 1.55,
          font: "inherit",
          marginBottom: 10,
        }}
      />

      {assessment && (
        <div className="refactor-grid" style={{ marginBottom: 12 }}>
          <RefactorBox label="요약" value={assessment.summary} />
          <RefactorBox label="모호한 이유" value={assessment.ambiguityReason} tone="warn" />
          <RefactorBox label="예상 절약" value={`~${assessment.estimatedSavedTokens.toLocaleString()} 토큰`} tone="good" />
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", marginBottom: advice || error ? 14 : 0 }}>
        <div style={{ fontSize: 11, color: "var(--muted)" }}>
          근거: TokenScope 초안 점검 + prompt-coach-wiki
        </div>
        <button className="btn active" onClick={runRefactor} disabled={loading}>
          {loading ? "리팩토링 중..." : "질문 리팩토링"}
        </button>
      </div>

      {error && (
        <div style={{ color: "var(--red)", fontSize: 12, lineHeight: 1.6 }}>
          {error}
        </div>
      )}

      {advice && (
        <div className="refactor-result">
          <div>
            <div className="refactor-section-title">체크 결과</div>
            <div className="refactor-result-box">
              {sections.summary || assessment?.summary}
              {sections.ambiguity && (
                <>
                  {"\n\n"}
                  {sections.ambiguity}
                </>
              )}
            </div>
          </div>
          <div>
            <div className="refactor-section-title">리팩토링 결과</div>
            <div className="refactor-result-box primary">
              {sections.refactored || advice}
            </div>
          </div>
          <div>
            <div className="refactor-section-title">개선된 점</div>
            <div className="refactor-result-box">
              {sections.improvement || assessment?.expectedImprovement}
              {sections.saving && (
                <>
                  {"\n\n"}
                  {sections.saving}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function RefactorBox({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "neutral" | "good" | "warn" }) {
  const color = tone === "good" ? "var(--green)" : tone === "warn" ? "var(--orange)" : "var(--text)";
  return (
    <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 6, padding: "10px 12px", minWidth: 0 }}>
      <div style={{ color: "var(--muted)", fontSize: 10, fontWeight: 800, marginBottom: 5 }}>{label}</div>
      <div style={{ color, fontSize: 12, lineHeight: 1.5 }}>{value}</div>
    </div>
  );
}

function parseCoachAdvice(advice: string) {
  return {
    summary: extractSection(advice, "요약", ["왜 모호한가", "문제", "다음에는 이렇게 질문하세요"]),
    ambiguity: extractSection(advice, "왜 모호한가", ["다음에는 이렇게 질문하세요", "개선된 점", "토큰 절약 포인트"]),
    refactored: cleanupCodeFence(extractSection(advice, "다음에는 이렇게 질문하세요", ["개선된 점", "토큰 절약 포인트"])),
    improvement: extractSection(advice, "개선된 점", ["토큰 절약 포인트"]),
    saving: extractSection(advice, "토큰 절약 포인트", []),
  };
}

function extractSection(text: string, title: string, nextTitles: string[]): string {
  const marker = `${title}:`;
  const start = text.indexOf(marker);
  if (start < 0) return "";

  const bodyStart = start + marker.length;
  const end = nextTitles
    .map(next => text.indexOf(`${next}:`, bodyStart))
    .filter(index => index >= 0)
    .sort((a, b) => a - b)[0] ?? text.length;

  return text.slice(bodyStart, end).trim();
}

function cleanupCodeFence(text: string): string {
  return text
    .replace(/^```[a-zA-Z]*\s*/, "")
    .replace(/```$/g, "")
    .trim();
}
