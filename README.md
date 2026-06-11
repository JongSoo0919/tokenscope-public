# TokenScope

TokenScope는 Claude, Gemini, Codex, Cursor 세션 로그를 로컬에서 분석해 사용자가 AI에게 일을 잘 맡기고 있는지 진단하는 데스크톱 앱입니다.

단순한 토큰 사용량 가계부가 아니라, 최근 세션을 근거로 "잘 쓰는 중 / 주의 / 낭비 심함"을 판정하고 다음 요청, 세션 분리, 상시 지침 파일 정리 방법을 제안합니다.

ccusage류 도구가 "얼마나 썼는지"를 보여주는 계기판이라면, TokenScope는 "왜 낭비됐고 다음에는 어떻게 줄일지"를 제안하는 로컬 AI 사용 코치입니다.

## 주요 기능

- **오늘의 판정:** 최근 5시간 세션을 기준으로 현재 AI 작업 방식의 건강 상태를 보여줍니다.
- **낭비 근거:** 도구 실패, 반복 요청, 낮은 컨텍스트 밀도, 세션 범위 혼합, 설정 파일 과비대를 설명합니다.
- **가장 큰 낭비 3개:** 예상 절약 토큰, 반복성, 바로 고칠 수 있는 정도를 기준으로 우선순위를 잡습니다.
- **질문 교정:** 넓고 모호한 요청을 찾아 "나쁜 요청 -> 좋은 요청" 예시와 작업 유형별 템플릿을 제공합니다.
- **질문 코치:** 내장 RAG 백엔드의 프롬프트 코치 위키를 근거로 현재 질문을 요약하고 다음 요청 예시를 제안합니다.
- **질문 리팩토링기:** AI에게 보내기 전 질문 초안을 점검하고 더 작고 명확한 요청으로 바꿉니다.
- **안전한 설정 파일 처방:** `CLAUDE.md`, `GEMINI.md`, `AGENTS.md` diff, 예상 절약량, 신뢰도, 백업 경로, 복원 동선을 제공합니다.
- **승인 기반 액션:** 사용자가 diff를 보고 승인해야만 설정 파일을 수정하며, LOW 신뢰도 처방은 자동 적용하지 않습니다.
- **5시간 블록 행동 추천:** 사용량과 세션 품질을 함께 보고 지금은 구현, 검증, 요약 중 무엇이 나은지 제안합니다.

## 지원 대상

- Claude: `~/.claude/projects/**/*.jsonl`, `~/.claude/CLAUDE.md`
- Gemini: `~/.gemini/tmp/**/*.json`, `~/.gemini/GEMINI.md`, `~/.config/gemini-cli/GEMINI.md`
- Codex: `~/.codex/sessions/**/*.jsonl`, `~/.codex/AGENTS.md`
- Cursor: `~/.cursor/chats/**/store.db`

## 진단하는 패턴

- `CONTEXT_BLOAT`: 상시 지침 파일이 매 요청마다 너무 큰 비용을 유발합니다.
- `RETRY_STORM`: 같은 요청이나 실패가 반복됩니다.
- `TOOL_THRASH`: 같은 도구가 연속으로 실패합니다.
- `SESSION_SCOPE_DRIFT`: 한 세션에 무관한 작업 흐름이 섞입니다.
- `PHASE_MIXING`: 기획, 구현, 검증이 한 세션에서 과하게 이어집니다.
- `BROAD_REQUEST`: "전체적으로", "알아서", "좋게" 같은 넓은 요청으로 작업 범위가 커집니다.

## 제품 포지션

TokenScope가 사용자가 바로 답하게 하려는 질문은 네 가지입니다.

- 내가 지금 AI를 잘 쓰고 있나?
- 어디서 제일 많이 새고 있나?
- 다음 요청을 어떻게 바꿔야 하나?
- 내가 승인하면 어떤 설정을 바꿔서 재발을 줄일 수 있나?

## 기능 구분

- **무료:** 최근 세션 분석, 건강 점수, 가장 큰 낭비 3개, 질문 가이드
- **Pro:** 승인 기반 설정 파일 자동 수정, 되돌리기 히스토리, 사용자 요청 압축 분석, 5시간 블록 행동 추천
- **Team:** 팀 전체 낭비 패턴 대시보드, 프로젝트별 지침 정책 관리, 공통 프롬프트 템플릿 배포

## 시작하기

### 사전 준비

- Node.js 18+
- Rust stable
- Yarn
- Python 3.10+
- Ollama 및 `qwen2.5:7b`, `bge-m3` 모델

### 설치 및 실행

이 저장소는 RAG 백엔드를 Git 서브모듈로 사용합니다. 처음 클론한 뒤에는 서브모듈을 먼저 초기화하세요.

```bash
git submodule update --init --recursive
```

```bash
./start.sh
```

`start.sh`는 내장 RAG API(`rag/`)와 TokenScope Tauri 앱을 함께 실행합니다. 종료는 다음 명령을 사용합니다.

Wiki 질문 REPL까지 한 터미널 흐름에서 바로 열려면 다음처럼 실행합니다.

```bash
./start.sh --ask
# 또는
yarn start:ask
```

시작하면서 CLI 진단도 한 번 같이 보고 싶으면 `--cli` 뒤에 CLI 인자를 그대로 넘깁니다. 인자를 생략하면 `list --provider cursor --limit 5`가 실행됩니다.

```bash
./start.sh --cli
./start.sh --ask --cli list --provider cursor --limit 5
```

```bash
./stop.sh
```

`start.sh`가 띄우는 것과 옵션으로 붙일 수 있는 것:

| 구성 요소 | `./start.sh` | 옵션 | 별도 실행 |
|-----------|--------------|------|-----------|
| RAG API (`127.0.0.1:8000`) | ✅ | - | `rag/.venv/bin/uvicorn tokenscope_rag.api:app --reload --host 127.0.0.1 --port 8000` |
| Tauri 데스크톱 앱 (`127.0.0.1:1420`) | ✅ | - | `yarn tauri dev` |
| TokenScope CLI (`yarn cli`) | 필요 시 1회 실행 | `--cli ...` | `yarn cli ...` |
| Wiki 질문 REPL | 필요 시 실행 | `--ask` | 아래 [Wiki 질문하기](#wiki-질문하기) 참고 |

`start.sh`를 실행한 터미널은 Tauri 프로세스를 `wait`하므로 블록됩니다. `--ask`를 쓰면 같은 터미널에서 Wiki 질문 REPL을 먼저 실행하고, REPL 종료 후 앱 프로세스를 기다립니다. `curl` 테스트는 **새 터미널 탭**에서 실행하세요.
### RAG 서브모듈과 TokenScope 코치

범용 RAG 백엔드는 `rag/` 경로의 `yanapang/viola-langchain` 서브모듈입니다. TokenScope 전용 질문 코치 API와 코칭 지식은 이 저장소의 `tokenscope_rag/`에 둡니다.

upstream RAG 변경분을 반영하려면 다음 명령으로 서브모듈 포인터를 갱신한 뒤 커밋하세요.

```bash
git submodule update --remote rag
git add rag
git commit -m "chore: update rag submodule"
```

- `rag/wiki`: RAG 샘플 위키
- `rag/.env.example`: 로컬 모델과 인덱스 설정
- `rag/.chroma`: 실행 중 생성되는 로컬 벡터 DB
- `tokenscope_rag/api.py`: `/coach-prompt`를 포함한 TokenScope 전용 RAG wrapper
- `tokenscope_rag/prompt-coach-wiki`: 질문 리팩토링과 토큰 절약 코칭 지식
- `tokenscope_rag/.chroma-prompt-coach`: 실행 중 생성되는 질문 코치 벡터 DB

RAG API 엔드포인트:

| 엔드포인트 | 용도 | 사용처 |
|------------|------|--------|
| `POST /ask` | `WIKI_DIR` 마크다운 위키 질의응답 | 터미널 REPL, `curl`, Swagger UI |
| `POST /ask/stream` | 위와 동일, SSE 스트리밍 | 클라이언트 연동 |
| `POST /coach-prompt` | 프롬프트 코치 위키 기반 질문 개선 (Hybrid Router 적용) | 데스크톱 앱 질문 코치·리팩토링기 |
| `GET /stats/routes` | Internal/External 라우팅 통계 | 대시보드, 모니터링 |

`/coach-prompt`는 **Hybrid AI Router**를 통해 wiki 관련도 점수에 따라 로컬 Ollama(내부) 또는 외부 LLM(Cursor / OpenAI)으로 자동 라우팅됩니다. 응답에는 `route`, `model`, `source`, `max_score` 필드가 포함됩니다. 설정과 통계 확인 방법은 [tokenscope_rag/HYBRID_ROUTER.md](tokenscope_rag/HYBRID_ROUTER.md)를 참고하세요.

데스크톱 앱의 **질문 코치**·**질문 리팩토링기**는 세션 질문 개선용이며, `WIKI_DIR` 위키 검색 UI는 아직 없습니다. Wiki를 물어보려면 아래 API나 REPL을 사용하세요.

### Wiki 질문하기

#### 1. Wiki 경로 설정

`rag/.env`에서 질문할 마크다운 위키 디렉터리를 지정합니다. `**/*.md` 파일만 인덱싱됩니다.

```bash
cp rag/.env.example rag/.env
# rag/.env 예시
WIKI_DIR=/path/to/your/wiki
OLLAMA_LLM_MODEL=qwen2.5:7b
OLLAMA_EMBED_MODEL=bge-m3
RESPONSE_LANGUAGE=ko
```

Wiki 내용을 바꿨거나 처음 연결했다면 벡터 DB를 다시 만듭니다.

```bash
rm -rf rag/.chroma
# 또는 REPL에서 --rebuild (아래 참고)
```

#### 2. RAG 서버 실행

`./start.sh`로 API가 이미 떠 있으면 추가 실행은 필요 없습니다. RAG만 단독으로 띄울 때:

```bash
rag/.venv/bin/uvicorn tokenscope_rag.api:app --reload --host 127.0.0.1 --port 8000
```

#### 3. 질문 방법

**브라우저 (가장 쉬움):** [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs) → `POST /ask` → Try it out

```json
{"question": "Viola Wiki 운영 규칙이 뭐야?"}
```

**curl (새 터미널):**

```bash
curl -X POST http://127.0.0.1:8000/ask \
  -H "Content-Type: application/json" \
  -d '{"question": "Viola Wiki 운영 규칙이 뭐야?"}'
```

**터미널 REPL (LangChain 체인 직접):**

```bash
./tokenscope_rag/ask.sh
```

또는:

```bash
rag/.venv/bin/python rag/src/app.py
```

`Ask a question:` 프롬프트에 질문을 입력하고, 종료는 `exit`입니다. Wiki 갱신 후 재인덱싱:

```bash
./tokenscope_rag/ask.sh --rebuild
```

> **주의:** `python` 또는 `python3`로 실행하지 마세요. macOS 기본 Python 3.9는 타입 문법(`str | None`)을 지원하지 않아 실패합니다. `./tokenscope_rag/ask.sh` 또는 `rag/.venv/bin/python`(Python 3.10+)을 사용하세요.

### 데스크톱 앱에서 질문 기능 쓰기

`./start.sh`로 앱을 연 뒤:

| 기능 | 위치 | RAG 사용 |
|------|------|----------|
| 질문 리팩토링기 | 대시보드 (세션 미선택) | `POST /coach-prompt` |
| 질문 코치 | 세션 선택 → **질문 코치** 탭 | `POST /coach-prompt` |
| 질문 가이드 | 세션 선택 → **질문 가이드** 탭 | 없음 (로컬 팁·템플릿) |

### 빌드

```bash
yarn build
```

### CLI 및 LangChain 연동

TokenScope 분석기를 데스크톱 앱 없이 CLI로 실행할 수 있습니다.

프로젝트 루트(`tokenscope-public/`)에서 실행하세요. `rag/` 디렉터리에서도 yarn이 루트 `package.json`을 찾아 동작합니다.

```bash
yarn cli list --provider cursor --limit 5
yarn cli analyze --provider cursor --format json
yarn cli export --provider cursor --limit 10 --langchain > cursor-sessions.jsonl
```

`list`는 기본으로 각 세션을 분석해 카드형 대시보드(건강 점수 바, 양호/주의/위험, 패턴, 요약, 스마트 팁)를 터미널에 보여줍니다. `--sort score`로 문제 세션 우선, `-v`로 경로 표시, `--quick`으로 경로만 빠르게 볼 수 있습니다.

`export --langchain`은 **세션 분석 결과**를 LangChain `Document` 형태의 JSONL로 출력합니다. 각 줄은 `pageContent`와 `metadata`를 포함하므로 `JSONLoader`나 커스텀 로더에서 바로 벡터화할 수 있습니다.

Wiki 질문과의 구분:

| 기능 | 입력 | 출력 |
|------|------|------|
| `yarn cli -- export --langchain` | AI 세션 로그 분석 | LangChain `Document` JSONL |
| `POST /ask` 또는 `rag/src/app.py` | `WIKI_DIR` 마크다운 위키 | RAG 답변 텍스트 |

## 프로젝트 구조

- `src/lib/parser.ts`: Claude, Gemini, Codex, Cursor 로그 파싱과 메시지 정규화
- `src/lib/analyzer.ts`: 낭비 패턴 감지, 건강 점수, 세션 요약 생성
- `src/lib/promptCoach.ts`: 질문 후보 추출, 초안 질문 점검, RAG 코치 API 호출
- `src/lib/prescriber.ts`: 설정 파일 처방, diff, 절약량 추정
- `src/components/Dashboard.tsx`: 최근 5시간 판정과 대시보드
- `src/components/QuestionRefactorer.tsx`: 메인 화면 질문 리팩토링기
- `src/components/PromptCoachPanel.tsx`: 세션 기반 질문 코치
- `src/components/FixPreview.tsx`: diff 미리보기, 적용, 안전 안내
- `src-tauri/src/lib.rs`: 로컬 세션/설정 파일 검색, 읽기, 백업, 복원
- `rag/`: 범용 RAG 서브모듈 (`viola-langchain`)
- `tokenscope_rag/api.py`: TokenScope RAG API (`/ask`, `/coach-prompt`)
- `tokenscope_rag/ask.sh`: Wiki 질문용 터미널 REPL 실행 스크립트

## 개인정보

모든 분석은 로컬에서 수행됩니다. 세션 로그, 설정 파일, 분석 결과는 외부 서버로 전송되지 않습니다.
