# TokenScope

TokenScope는 Claude, Gemini, Codex 세션 로그를 로컬에서 분석해 사용자가 AI에게 일을 잘 맡기고 있는지 진단하는 데스크톱 앱입니다.

단순한 토큰 사용량 가계부가 아니라, 최근 세션을 근거로 "잘 쓰는 중 / 주의 / 낭비 심함"을 판정하고 다음 요청, 세션 분리, 상시 지침 파일 정리 방법을 제안합니다.

## 주요 기능

- **오늘의 판정:** 최근 5시간 세션을 기준으로 현재 AI 작업 방식의 건강 상태를 보여줍니다.
- **낭비 근거:** 도구 실패, 반복 요청, 낮은 컨텍스트 밀도, 세션 범위 혼합, 설정 파일 과비대를 설명합니다.
- **가장 큰 낭비 3개:** 예상 절약 토큰, 반복성, 바로 고칠 수 있는 정도를 기준으로 우선순위를 잡습니다.
- **질문 가이드:** 나쁜 요청을 좋은 요청으로 바꾸는 예시와 작업 유형별 프롬프트 템플릿을 제공합니다.
- **안전한 설정 파일 처방:** `CLAUDE.md`, `GEMINI.md`, `AGENTS.md` diff, 예상 절약량, 신뢰도, 백업 경로, 복원 동선을 제공합니다.

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

## 시작하기

### 사전 준비

- Node.js 18+
- Rust stable
- Yarn

### 설치 및 실행

```bash
yarn install
yarn tauri dev
```

### 빌드

```bash
yarn build
```

## 프로젝트 구조

- `src/lib/parser.ts`: Claude, Gemini, Codex 로그 파싱과 메시지 정규화
- `src/lib/analyzer.ts`: 낭비 패턴 감지, 건강 점수, 세션 요약 생성
- `src/lib/prescriber.ts`: 설정 파일 처방, diff, 절약량 추정
- `src/components/Dashboard.tsx`: 최근 5시간 판정과 대시보드
- `src/components/FixPreview.tsx`: diff 미리보기, 적용, 안전 안내
- `src-tauri/src/lib.rs`: 로컬 세션/설정 파일 검색, 읽기, 백업, 복원

## 개인정보

모든 분석은 로컬에서 수행됩니다. 세션 로그, 설정 파일, 분석 결과는 외부 서버로 전송되지 않습니다.
