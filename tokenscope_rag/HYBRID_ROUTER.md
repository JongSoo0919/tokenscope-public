# Hybrid AI Router 사용 가이드

TokenScope RAG API에 추가된 Hybrid AI Router는 질문이 들어올 때마다 wiki 관련도 점수를 계산해, 로컬 Ollama(내부) 또는 외부 LLM(Cursor / OpenAI)으로 자동 라우팅합니다.

---

## 동작 원리

```
사용자 질문
    │
    ▼
[Router] prompt-coach-wiki 벡터 검색
    │
    ├─ score >= 0.8 (wiki와 높은 관련도)
    │       ↓
    │   Internal Route
    │   Ollama + 검색된 wiki 문서를 컨텍스트로 사용
    │
    ├─ 0.3 < score < 0.8 (중간 관련도)
    │       ↓
    │   Internal Route (보수적 기본값)
    │   추후 Hybrid Route로 확장 가능
    │
    └─ score <= 0.3 (wiki와 낮은 관련도)
            ↓
        External Route
        Cursor / OpenAI 등 외부 LLM 사용
```

score는 Chroma `similarity_search_with_relevance_scores`가 반환하는 코사인 유사도(0.0 ~ 1.0)입니다.

---

## 설정

`rag/.env` 파일에서 아래 항목을 수정합니다. 없으면 기본값이 적용됩니다.

```env
# 외부 LLM 프로바이더 선택 (기본: cursor)
EXTERNAL_LLM_PROVIDER=cursor   # cursor | openai | huggingface

# 라우팅 임계값 (기본값 권장)
ROUTER_INTERNAL_THRESHOLD=0.8
ROUTER_EXTERNAL_THRESHOLD=0.3
```

### 외부 프로바이더별 추가 설정

| 프로바이더 | 추가 필요 환경변수 |
|-----------|-----------------|
| `cursor` (기본) | `CURSOR_API_KEY`, `CURSOR_MODEL` |
| `openai` | `OPENAI_API_KEY`, `OPENAI_LLM_MODEL` |
| `huggingface` | `HUGGINGFACEHUB_API_TOKEN`, `HF_LLM_MODEL` |

외부 프로바이더 자격증명이 없으면 서버가 경고를 출력하고 모든 질문을 내부 라우트(Ollama)로 처리합니다. 앱이 시작되지 않거나 에러가 나지는 않습니다.

---

## API 응답 형식

`POST /coach-prompt` 응답에 다음 필드가 추가됩니다.

```json
{
  "advice": "...",
  "route": "internal",
  "model": "qwen2.5:7b",
  "source": [
    "tokenscope_rag/prompt-coach-wiki/token-economy.md"
  ],
  "max_score": 0.87
}
```

```json
{
  "advice": "...",
  "route": "external",
  "model": "composer-2.5",
  "source": [],
  "max_score": 0.21
}
```

| 필드 | 설명 |
|------|------|
| `advice` | 코치 답변 본문 |
| `route` | `"internal"` (로컬 Ollama) 또는 `"external"` (외부 LLM) |
| `model` | 실제 답변을 생성한 모델 이름 |
| `source` | 내부 라우트일 때 사용된 wiki 파일 경로 목록 (외부 라우트는 빈 배열) |
| `max_score` | 라우팅 결정에 사용된 최고 관련도 점수 (0.0 ~ 1.0) |

---

## 실행 및 테스트

### 서버 시작

```bash
./start.sh
```

또는 RAG API만 단독으로:

```bash
rag/.venv/bin/uvicorn tokenscope_rag.api:app --reload --host 127.0.0.1 --port 8000
```

시작 로그에서 외부 프로바이더 초기화 결과를 확인할 수 있습니다.

```
[HybridRouter] External provider ready: composer-2.5
```

또는 자격증명이 없는 경우:

```
[HybridRouter] No external provider configured — external routes fall back to internal.
```

---

### curl로 라우팅 확인

**내부 라우트가 예상되는 질문** (wiki 주제 관련):

```bash
curl -s -X POST http://127.0.0.1:8000/coach-prompt \
  -H "Content-Type: application/json" \
  -d '{"question": "컨텍스트 블로트 패턴이 뭐야?"}' | python3 -m json.tool
```

**외부 라우트가 예상되는 질문** (wiki와 무관한 일반 질문):

```bash
curl -s -X POST http://127.0.0.1:8000/coach-prompt \
  -H "Content-Type: application/json" \
  -d '{"question": "파이썬에서 정렬 알고리즘 종류를 알려줘"}' | python3 -m json.tool
```

응답에서 `route`, `model`, `max_score`를 확인하세요.

---

### Swagger UI

[http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs) → `POST /coach-prompt` → Try it out

---

## 라우팅 통계 확인

`GET /stats/routes`는 현재 프로세스가 처리한 누적 라우팅 통계를 반환합니다.

```bash
curl -s http://127.0.0.1:8000/stats/routes | python3 -m json.tool
```

```json
{
  "total": 42,
  "route_counts": {
    "internal": 35,
    "external": 7
  },
  "route_ratio": {
    "internal": 0.833,
    "external": 0.167
  },
  "top_sources": [
    { "source": "tokenscope_rag/prompt-coach-wiki/token-economy.md", "count": 18 },
    { "source": "tokenscope_rag/prompt-coach-wiki/prompt-patterns.md", "count": 12 }
  ]
}
```

---

## 라우팅 로그 파일

`.run/route_log.jsonl`에 요청마다 한 줄씩 JSONL 형태로 기록됩니다.

```jsonl
{"ts": "2026-06-11T07:23:01+00:00", "route": "internal", "model": "qwen2.5:7b", "source": ["tokenscope_rag/prompt-coach-wiki/token-economy.md"], "score": 0.87}
{"ts": "2026-06-11T07:24:15+00:00", "route": "external", "model": "composer-2.5", "source": [], "score": 0.21}
```

최근 10건 보기:

```bash
tail -10 .run/route_log.jsonl | python3 -c "import sys,json; [print(json.dumps(json.loads(l), ensure_ascii=False, indent=2)) for l in sys.stdin]"
```

route별 집계:

```bash
cat .run/route_log.jsonl | python3 -c "
import sys, json
from collections import Counter
counts = Counter(json.loads(l)['route'] for l in sys.stdin)
print(dict(counts))
"
```

---

## 임계값 조정

점수 분포를 확인하고 싶으면 로그의 `score` 값 분포를 살펴보세요.

```bash
cat .run/route_log.jsonl | python3 -c "
import sys, json
scores = [json.loads(l)['score'] for l in sys.stdin]
if scores:
    print(f'min: {min(scores):.3f}  max: {max(scores):.3f}  avg: {sum(scores)/len(scores):.3f}')
"
```

대부분의 요청이 외부로 라우팅된다면 `ROUTER_EXTERNAL_THRESHOLD`를 낮추세요.
대부분 내부이지만 답변 품질이 낮다면 `ROUTER_INTERNAL_THRESHOLD`를 높여 외부 비율을 늘리세요.

변경 후 서버를 재시작하면 즉시 적용됩니다.

---

## 파일 구조 참고

```
tokenscope_rag/
├── api.py                    # /coach-prompt, /stats/routes 엔드포인트
├── router.py                 # RouterResult, route() — 점수 계산 + 라우팅
├── external_provider.py      # ExternalLLMProvider, create_external_provider()
├── route_logger.py           # RouteLogger — JSONL 기록 + 인메모리 통계
└── prompt-coach-wiki/        # 내부 라우트용 코칭 지식
```

---

## 문제 해결

| 증상 | 원인 | 해결 |
|------|------|------|
| 모든 요청이 `internal`로만 라우팅됨 | `EXTERNAL_LLM_PROVIDER` 자격증명 미설정 | `rag/.env`에 API 키 추가 후 재시작 |
| `max_score`가 항상 0에 가까움 | 벡터 DB가 빈 상태 또는 임베딩 모델 불일치 | `rm -rf tokenscope_rag/.chroma-prompt-coach` 후 재시작 |
| 외부 LLM이 한국어로 답하지 않음 | 외부 라우트는 wiki 프롬프트 템플릿 없이 질문 그대로 전달 | `external_provider.py`의 `generate()`에서 한국어 지시문 추가 가능 |
| `.run/route_log.jsonl` 파일 없음 | 아직 요청을 처리한 적 없거나 `.run/` 디렉터리 권한 문제 | 요청 1회 이상 처리 후 자동 생성됨 |
