import { SessionData } from "../lib/parser";
import { isHumanVisibleMessage } from "../lib/parser";
import { DiagnosticResult } from "../lib/analyzer";

interface Props {
  session: SessionData;
  diagnostic: DiagnosticResult;
}

function fmt(n: number): string {
  return n.toLocaleString("ko-KR");
}

function scoreClass(score: number): string {
  if (score >= 70) return "good";
  if (score >= 40) return "warn";
  return "bad";
}

function scoreLabel(score: number): string {
  if (score >= 70) return "양호";
  if (score >= 40) return "주의";
  return "위험";
}

function formatDuration(start: string, end: string): string {
  if (!start || !end) return "-";
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 0) return "-";
  const m = Math.floor(ms / 60000);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}시간 ${m % 60}분`;
  if (m > 0) return `${m}분`;
  return "1분 미만";
}

interface MeterProps {
  label: string;
  score: number;
  hint: string;
}

function ScoreMeter({ label, score, hint }: MeterProps) {
  const cls = scoreClass(score);
  const color = cls === "good" ? "var(--green)" : cls === "warn" ? "var(--orange)" : "var(--red)";
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ fontSize: 12, color: "var(--text)" }}>{label}</span>
        <span style={{ fontSize: 12, fontWeight: 700, color }}>{score}점</span>
      </div>
      <div style={{ background: "var(--surface2)", borderRadius: 4, height: 6, overflow: "hidden" }}>
        <div style={{ width: `${score}%`, height: "100%", background: color, transition: "width 0.4s ease", borderRadius: 4 }} />
      </div>
      <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 3 }}>{hint}</div>
    </div>
  );
}

export function SummaryCard({ session, diagnostic }: Props) {
  const { scoreBreakdown: bd, sessionSummary, sessionDigest } = diagnostic;
  const configLabel = session.provider === "gemini" ? "GEMINI.md" : session.provider === "codex" ? "AGENTS.md" : session.provider === "cursor" ? "Cursor Rules" : "CLAUDE.md";
  const userTurns = session.messages.filter(m => m.role === "user" && isHumanVisibleMessage(m)).length;
  const internalEvents = Math.max(0, session.messages.length - userTurns);

  return (
    <>
      {/* 세션 요약 */}
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="card-title">세션 요약</div>
        <div style={{ fontSize: 13, color: "var(--text)", marginBottom: 10, lineHeight: 1.5 }}>
          {sessionSummary}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 12 }}>
          <DigestBlock title="핵심 요청" items={sessionDigest.keyRequests} />
          <DigestBlock title="수행 흐름" items={sessionDigest.assistantActions} />
          <DigestBlock title="토큰 조언" items={sessionDigest.tokenAdvice} />
        </div>
        <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
          <span style={{ fontSize: 11, color: "var(--muted)" }}>사용자 요청 {fmt(userTurns)}턴</span>
          <span style={{ fontSize: 11, color: "var(--muted)" }}>내부 이벤트 {fmt(internalEvents)}개</span>
          <span style={{ fontSize: 11, color: "var(--muted)" }}>소요 {formatDuration(session.startTime, session.endTime)}</span>
          <span style={{ fontSize: 11, color: "var(--muted)" }}>공급자 {session.provider}</span>
          <span style={{ fontSize: 11, color: "var(--muted)" }}>모델 {session.model.replace("claude-", "").slice(0, 24)}</span>
          {session.parseErrors > 0 && (
            <span style={{ fontSize: 11, color: "var(--orange)" }}>파싱 오류 {session.parseErrors}개</span>
          )}
        </div>
      </div>

      {/* 토큰 통계 */}
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="card-title">토큰 사용량</div>
        <div className="stat-grid">
          <div className="stat-box">
            <div className="stat-label">입력</div>
            <div className="stat-value blue">{fmt(session.totalInputTokens)}</div>
          </div>
          <div className="stat-box">
            <div className="stat-label">출력</div>
            <div className="stat-value green">{fmt(session.totalOutputTokens)}</div>
          </div>
          <div className="stat-box">
            <div className="stat-label">캐시 읽기</div>
            <div className="stat-value orange">{fmt(session.totalCacheReadTokens)}</div>
          </div>
          <div className="stat-box">
            <div className="stat-label">캐시 생성</div>
            <div className="stat-value orange">{fmt(session.totalCacheCreationTokens)}</div>
          </div>
        </div>
      </div>

      {/* 건강 점수 */}
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="card-title">건강 점수</div>
        <div style={{ display: "flex", gap: 24, alignItems: "flex-start" }}>
          {/* 종합 점수 */}
          <div style={{ minWidth: 80, textAlign: "center", paddingTop: 4 }}>
            <div className={`score-num ${scoreClass(bd.overall)}`}>{bd.overall}</div>
            <div className="score-label">/ 100</div>
            <div className="score-label" style={{ marginTop: 4, fontWeight: 600 }}>{scoreLabel(bd.overall)}</div>
          </div>

          {/* 세부 지표 */}
          <div style={{ flex: 1 }}>
            <ScoreMeter label="캐시 효율" score={bd.cacheEfficiency} hint={bd.explanations.cacheEfficiency} />
            <ScoreMeter label="도구 성공률" score={bd.toolSuccessRate} hint={bd.explanations.toolSuccessRate} />
            <ScoreMeter label="컨텍스트 밀도" score={bd.contextDensity} hint={bd.explanations.contextDensity} />
            <ScoreMeter label={`${configLabel} 상시 비용`} score={bd.claudeMdHealth} hint={bd.explanations.claudeMdHealth} />
            <ScoreMeter label="반복 요청" score={bd.retryHealth} hint={bd.explanations.retryHealth} />
            <ScoreMeter label="세션 집중도" score={bd.actionFocus} hint={bd.explanations.actionFocus} />
          </div>
        </div>

        {/* 가중치 안내 */}
        <div style={{ marginTop: 12, fontSize: 11, color: "var(--muted)", borderTop: "1px solid var(--border)", paddingTop: 8 }}>
          가중치: 캐시 · 도구성공 · 컨텍스트밀도 · 설정파일 · 반복요청 · 세션집중도
        </div>
      </div>
    </>
  );
}

function DigestBlock({ title, items }: { title: string; items: string[] }) {
  return (
    <div style={{ background: "var(--surface2)", borderRadius: 6, padding: 10, minHeight: 78 }}>
      <div style={{ fontSize: 11, color: "var(--muted)", fontWeight: 700, marginBottom: 6 }}>{title}</div>
      {items.length === 0 ? (
        <div style={{ fontSize: 11, color: "var(--muted)" }}>-</div>
      ) : items.slice(0, 3).map((item, i) => (
        <div key={i} style={{ fontSize: 11, color: "var(--text)", lineHeight: 1.45, marginBottom: 4 }}>
          {item}
        </div>
      ))}
    </div>
  );
}
