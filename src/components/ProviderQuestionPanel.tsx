import { useEffect, useMemo, useState } from "react";
import { requestProviderQa, requestProviderQaHistory, ProviderQaHistoryItem, ProviderScope } from "../lib/providerQa";

interface Props {
  provider: ProviderScope;
}

export function ProviderQuestionPanel({ provider }: Props) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [sources, setSources] = useState<string[]>([]);
  const [sessionsUsed, setSessionsUsed] = useState(0);
  const [scopeSummary, setScopeSummary] = useState("");
  const [history, setHistory] = useState<ProviderQaHistoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scopeLabel = useMemo(() => {
    if (provider === "all") return "전체 provider";
    return provider === "wiki" ? "WIKI" : provider.charAt(0).toUpperCase() + provider.slice(1);
  }, [provider]);

  const loadHistory = async () => {
    setHistoryLoading(true);
    try {
      const items = await requestProviderQaHistory(provider, 8);
      setHistory(items);
    } catch (e) {
      console.warn("Failed to load provider QA history", e);
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  };

  useEffect(() => {
    void loadHistory();
  }, [provider]);

  const run = async () => {
    const trimmed = question.trim();
    if (!trimmed) {
      setError("질문을 입력하세요.");
      return;
    }

    setLoading(true);
    setError(null);
    setAnswer("");
    setSources([]);
    setSessionsUsed(0);
    setScopeSummary("");

    try {
      const response = await requestProviderQa({ provider, question: trimmed });
      setAnswer(response.answer);
      setSources(response.sources ?? []);
      setSessionsUsed(response.sessions_used ?? 0);
      setScopeSummary(response.scope_summary ?? "");
      void loadHistory();
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-title">provider 질문</div>
      <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.6, marginBottom: 10 }}>
        현재 선택된 범위: <strong style={{ color: "var(--text)" }}>{scopeLabel}</strong>. 이 범위의 세션 질문과 답변, 스코프 신호를 기준으로 물어볼 수 있습니다.
      </div>

      <textarea
        value={question}
        onChange={event => setQuestion(event.target.value)}
        placeholder={`${scopeLabel} 범위에서 어떤 패턴이 반복됐는지 알려줘`}
        style={{
          width: "100%",
          minHeight: 96,
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

      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", marginBottom: 12 }}>
        <div style={{ fontSize: 11, color: "var(--muted)" }}>
          질문 범위: {scopeLabel} · 참고 세션 {sessionsUsed}개
        </div>
        <button className="btn active" onClick={run} disabled={loading}>
          {loading ? "질문 중..." : "질문하기"}
        </button>
      </div>

      {error && (
        <div style={{ color: "var(--red)", fontSize: 12, lineHeight: 1.6, marginBottom: 12 }}>
          {error}
        </div>
      )}

      {answer && (
        <div style={{
          background: "var(--surface2)",
          border: "1px solid var(--border)",
          borderRadius: 6,
          padding: 14,
          whiteSpace: "pre-wrap",
          lineHeight: 1.65,
          fontSize: 13,
          color: "var(--text)",
        }}>
          {answer}

          {scopeSummary && (
            <div style={{ marginTop: 12, fontSize: 11, color: "var(--muted)", whiteSpace: "pre-wrap" }}>
              스코프 요약: {scopeSummary}
            </div>
          )}

          {sources.length > 0 && (
            <div style={{ marginTop: 12, fontSize: 11, color: "var(--muted)" }}>
              출처: {sources.join(" · ")}
            </div>
          )}
        </div>
      )}

      <div style={{ marginTop: 14, borderTop: "1px solid var(--border)", paddingTop: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 600 }}>최근 질문 기록</div>
          <button className="btn ghost" onClick={() => void loadHistory()} disabled={historyLoading} style={{ fontSize: 11, padding: "4px 8px" }}>
            {historyLoading ? "불러오는 중..." : "새로고침"}
          </button>
        </div>

        {history.length === 0 ? (
          <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.6 }}>
            아직 이 provider 범위에서 저장된 질문이 없습니다.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {history.map(item => (
              <div key={`${item.timestamp}-${item.question.slice(0, 12)}`} style={{
                border: "1px solid var(--border)",
                background: "var(--surface2)",
                borderRadius: 6,
                padding: 10,
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 6 }}>
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>
                    {new Date(item.timestamp).toLocaleString("ko-KR")} · 세션 {item.sessions_used}개
                  </div>
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>
                    {item.provider.toUpperCase()}
                  </div>
                </div>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6, lineHeight: 1.45 }}>
                  Q. {item.question}
                </div>
                <div style={{ fontSize: 12, color: "var(--text)", lineHeight: 1.55, whiteSpace: "pre-wrap" }}>
                  {item.answer.length > 240 ? `${item.answer.slice(0, 240)}…` : item.answer}
                </div>
                {item.sources.length > 0 && (
                  <div style={{ marginTop: 8, fontSize: 11, color: "var(--muted)" }}>
                    출처: {item.sources.join(" · ")}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
