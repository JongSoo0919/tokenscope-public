# Repository Guidelines

## 프로젝트 구조와 모듈 구성

TokenScope는 React/Vite 프론트엔드, Tauri v2 Rust 데스크톱 셸, Python FastAPI 기반 RAG 백엔드로 구성된 로컬 데스크톱 앱입니다.

- `src/`: React UI와 TypeScript 도메인 로직입니다. `components/`는 화면과 패널, `lib/`는 파서, 분석기, 프롬프트 코치, 처방 로직을 담습니다.
- `src-tauri/`: Tauri Rust 앱, 파일 시스템 명령, 권한 설정, 아이콘, Cargo 설정이 있습니다.
- `rag/`: RAG API 서버입니다. 소스는 `rag/src/`, 프롬프트 코치 지식은 `rag/prompt-coach-wiki/`, 샘플 위키는 `rag/wiki/`에 있습니다.
- `dogfood/`: 제품 검증용 로컬 세션 예시와 리뷰 자료를 둡니다.
- `start.sh`, `stop.sh`: RAG API와 Tauri 개발 앱을 함께 실행/종료합니다.

`node_modules/`, `.run/`, `rag/.venv/`, `rag/.chroma*/`, IDE 설정 파일은 생성물로 보고 소스 변경에 포함하지 마세요.

## 빌드, 테스트, 개발 명령

- `./start.sh`: 누락된 의존성을 설치하고 RAG API(`127.0.0.1:8000`)와 Tauri/Vite 앱(`127.0.0.1:1420`)을 실행합니다.
- `./stop.sh`: `.run/`에 기록된 앱과 RAG 프로세스를 종료합니다.
- `yarn install`: 프론트엔드와 Tauri JavaScript 의존성을 설치합니다.
- `yarn dev`: Vite 프론트엔드만 실행합니다.
- `yarn tauri dev`: Tauri 데스크톱 앱을 개발 모드로 실행합니다.
- `yarn build`: TypeScript 검사를 수행하고 Vite 프론트엔드를 빌드합니다.
- `cd rag && .venv/bin/uvicorn src.api:app --reload --host 127.0.0.1 --port 8000`: RAG API만 직접 실행합니다.

필수 환경은 Node.js 18+, Yarn, Rust/Cargo stable, Python 3.10+, README에 적힌 Ollama 모델입니다.

## 코딩 스타일과 네이밍 규칙

TypeScript/React는 함수형 컴포넌트와 2칸 들여쓰기를 사용합니다. React 컴포넌트는 `PascalCase`, 훅과 헬퍼는 `camelCase`, 파일명은 기존 패턴(`Dashboard.tsx`, `promptCoach.ts`)을 따릅니다. Rust 함수와 Python 모듈은 `snake_case`를 사용합니다. 새 코드는 가능한 한 `src/lib`와 `src/components`의 기존 경계 안에 작게 배치하세요.

## 테스트 지침

현재 별도 테스트 스크립트는 없습니다. 변경 전후로 최소 `yarn build`를 실행하고, 사용자 흐름 변경은 `./start.sh`로 직접 확인하세요. RAG 변경은 `http://127.0.0.1:8000/docs` 접속과 관련 엔드포인트 호출로 검증합니다. 테스트 프레임워크를 추가할 때는 광범위한 스냅샷보다 변경된 로직 중심의 작은 테스트를 우선합니다.

## 커밋과 Pull Request 지침

최근 이력은 짧은 명령형 요약과 `feat: integrate prompt coach rag` 같은 Conventional Commit 형식을 함께 사용합니다. 가능하면 `feat:`, `fix:`, `docs:` 접두사나 간결한 명령형 문장을 사용하세요. PR에는 사용자 관점 변경 내용, 검증한 명령, 관련 이슈, UI 변경 시 스크린샷을 포함합니다.

## 보안과 설정 주의사항

로컬 세션 로그, 생성된 벡터 DB, `.env`, 가상환경, 개인 IDE 상태는 커밋하지 마세요. 로컬 모델 토큰과 경로는 `rag/.env.example`을 기준으로 `rag/.env`에만 둡니다.
