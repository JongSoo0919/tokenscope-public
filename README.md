# TokenScope

TokenScope는 Claude, Gemini, Codex 세션 로그를 로컬에서 분석해 사용자가 AI에게 일을 잘 맡기고 있는지 진단하는 데스크톱 앱입니다.

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

```bash
./start.sh
```

`start.sh`는 내장 RAG API(`rag/`)와 TokenScope Tauri 앱을 함께 실행합니다. 종료는 다음 명령을 사용합니다.

```bash
./stop.sh
```

TokenScope는 `http://127.0.0.1:8000/coach-prompt`로 현재 세션 요약, 감지된 낭비 패턴, 최근 사용자 메시지 또는 질문 초안을 보내고 질문 개선안을 받아옵니다.

### 질문 코치 RAG

RAG 백엔드는 이 저장소의 `rag/` 하위에 포함되어 있습니다.

- `rag/wiki`: 일반 RAG 샘플 위키
- `rag/prompt-coach-wiki`: 질문 리팩토링과 토큰 절약 코칭 지식
- `rag/.env.example`: 로컬 모델과 인덱스 설정
- `rag/.chroma`, `rag/.chroma-prompt-coach`: 실행 중 생성되는 로컬 벡터 DB

### 빌드

```bash
yarn build
```

## 프로젝트 구조

- `src/lib/parser.ts`: Claude, Gemini, Codex 로그 파싱과 메시지 정규화
- `src/lib/analyzer.ts`: 낭비 패턴 감지, 건강 점수, 세션 요약 생성
- `src/lib/promptCoach.ts`: 질문 후보 추출, 초안 질문 점검, RAG 코치 API 호출
- `src/lib/prescriber.ts`: 설정 파일 처방, diff, 절약량 추정
- `src/components/Dashboard.tsx`: 최근 5시간 판정과 대시보드
- `src/components/QuestionRefactorer.tsx`: 메인 화면 질문 리팩토링기
- `src/components/PromptCoachPanel.tsx`: 세션 기반 질문 코치
- `src/components/FixPreview.tsx`: diff 미리보기, 적용, 안전 안내
- `src-tauri/src/lib.rs`: 로컬 세션/설정 파일 검색, 읽기, 백업, 복원
- `rag/src/api.py`: 내장 RAG FastAPI 서버

## 개인정보

모든 분석은 로컬에서 수행됩니다. 세션 로그, 설정 파일, 분석 결과는 외부 서버로 전송되지 않습니다.
