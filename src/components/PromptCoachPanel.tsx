import { useEffect, useMemo, useState } from "react";
import { DiagnosticResult } from "../lib/analyzer";
import {
  PromptQuestionCandidate,
  buildPromptCoachRequest,
  buildPromptQuestionCandidates,
  requestPromptCoach,
} from "../lib/promptCoach";

interface Props {
  diagnostic: DiagnosticResult;
}

export function PromptCoachPanel({ diagnostic }: Props) {
  const candidates = useMemo(() => buildPromptQuestionCandidates(diagnostic), [diagnostic]);
  const defaultCandidate = candidates[0] ?? null;

  const [selectedId, setSelectedId] = useState(defaultCandidate?.id ?? "");
  const [question, setQuestion] = useState(defaultCandidate?.question ?? "");
  const [advice, setAdvice] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSelectedId(defaultCandidate?.id ?? "");
    setQuestion(defaultCandidate?.question ?? "");
    setAdvice("");
    setError(null);
  }, [defaultCandidate?.id, defaultCandidate?.question]);

  const selectedCandidate = candidates.find(candidate => candidate.id === selectedId) ?? defaultCandidate;

  const selectCandidate = (candidate: PromptQuestionCandidate) => {
    setSelectedId(candidate.id);
    setQuestion(candidate.question);
    setAdvice("");
    setError(null);
  };

  const runCoach = async () => {
    const trimmed = question.trim();
    if (!trimmed) {
      setError("분석할 질문이 없습니다.");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const response = await requestPromptCoach(buildPromptCoachRequest(diagnostic, trimmed, selectedCandidate));
      setAdvice(response.advice);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <div className="card">
        <div className="card-title">질문 코치</div>
        <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.6, marginBottom: 12 }}>
          세션에서 개선할 질문을 고르면 TokenScope 진단과 프롬프트 코치 위키를 함께 보고 다음 요청 문장으로 바꿉니다.
        </div>

        {candidates.length === 0 ? (
          <div className="empty" style={{ padding: "24px 8px" }}>
            분석할 사용자 질문이 없습니다.
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 8, marginBottom: 12 }}>
            {candidates.map(candidate => (
              <button
                key={candidate.id}
                className={`question-candidate ${selectedId === candidate.id ? "active" : ""}`}
                onClick={() => selectCandidate(candidate)}
                type="button"
              >
                <span>{candidate.label}</span>
                <strong>{preview(candidate.question, 86)}</strong>
                <small>{candidate.reason}</small>
              </button>
            ))}
          </div>
        )}

        {selectedCandidate && (
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
            gap: 8,
            marginBottom: 12,
          }}>
            <CoachMetric label="선택 기준" value={getCandidateKindLabel(selectedCandidate.kind)} />
            <CoachMetric label="비효율 신호" value={`${selectedCandidate.score}점`} tone={selectedCandidate.score >= 70 ? "bad" : selectedCandidate.score >= 45 ? "warn" : "good"} />
            <CoachMetric label="예상 절약" value={`~${selectedCandidate.estimatedSavedTokens.toLocaleString()} 토큰`} tone="good" />
            <CoachMetric label="세션 집중도" value={`${diagnostic.scoreBreakdown.actionFocus}점`} tone={diagnostic.scoreBreakdown.actionFocus < 60 ? "bad" : diagnostic.scoreBreakdown.actionFocus < 80 ? "warn" : "good"} />
          </div>
        )}

        {selectedCandidate && (
          <div style={{
            background: "var(--surface2)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            padding: 12,
            marginBottom: 12,
            fontSize: 12,
            lineHeight: 1.6,
          }}>
            <div style={{ fontWeight: 800, marginBottom: 6 }}>왜 개선 대상인가</div>
            <div style={{ color: "var(--muted)", marginBottom: 8 }}>{selectedCandidate.reason}</div>
            <div style={{ fontWeight: 800, marginBottom: 6 }}>개선되는 면</div>
            <div style={{ color: "var(--muted)" }}>{selectedCandidate.improvement}</div>
          </div>
        )}

        <textarea
          value={question}
          onChange={event => setQuestion(event.target.value)}
          style={{
            width: "100%",
            minHeight: 132,
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

        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
          <div style={{ fontSize: 11, color: "var(--muted)" }}>
            근거: TokenScope 진단 + prompt-coach-wiki
          </div>
          <button className="btn active" onClick={runCoach} disabled={loading}>
            {loading ? "분석 중..." : "질문 개선안 만들기"}
          </button>
        </div>
      </div>

      {error && (
        <div className="card" style={{ color: "var(--red)", fontSize: 12, lineHeight: 1.6 }}>
          {error}
        </div>
      )}

      {advice && (
        <div className="card">
          <div className="card-title">다음 질문 제안</div>
          <div style={{
            whiteSpace: "pre-wrap",
            lineHeight: 1.65,
            fontSize: 13,
            color: "var(--text)",
            background: "var(--surface2)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            padding: 14,
          }}>
            {advice}
          </div>
        </div>
      )}
    </div>
  );
}

function CoachMetric({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "neutral" | "good" | "warn" | "bad" }) {
  const color = tone === "good" ? "var(--green)" : tone === "warn" ? "var(--orange)" : tone === "bad" ? "var(--red)" : "var(--text)";
  return (
    <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 6, padding: "9px 10px" }}>
      <div style={{ color: "var(--muted)", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 3 }}>
        {label}
      </div>
      <div style={{ color, fontSize: 13, fontWeight: 800 }}>{value}</div>
    </div>
  );
}

function getCandidateKindLabel(kind: PromptQuestionCandidate["kind"]): string {
  if (kind === "recent") return "최근 질문";
  if (kind === "broad") return "모호한 질문";
  return "효율 낮음";
}

function preview(text: string, max: number): string {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length > max ? `${compact.slice(0, max - 1)}…` : compact;
}
