# TokenScope 🔍

**TokenScope**는 Claude Code 세션 로그를 정밀 분석하여 LLM 토큰 사용량을 모니터링하고, 비용 최적화 방안을 제시하는 Tauri 기반의 데스크탑 애플리케이션입니다.

## 🚀 주요 기능

- **토큰 사용량 대시보드:** 실시간으로 세션별 Input, Output, Cache 토큰 사용량을 시각화합니다.
- **비용 추정:** 주요 모델 공급자(Anthropic, Google Gemini, OpenAI)의 가격 정책을 기반으로 예상 비용을 계산합니다.
- **지능형 진단 (Diagnostic):** 컨텍스트 과부하, 캐시 효율 저하, 비정상적 토큰 낭비 패턴을 자동으로 탐지합니다.
- **최적화 처방 (Prescription):** 분석된 데이터를 바탕으로 `CLAUDE.md` 수정 제안 등 토큰을 절약할 수 있는 구체적인 가이드를 제공합니다.
- **세션 히스토리 관리:** 과거 대화 기록을 파싱하여 프로젝트별, 세션별 통계를 유지합니다.

## 🛠 기술 스택

- **Frontend:** React, TypeScript, Vite, Tailwind CSS
- **Backend:** Rust (Tauri)
- **Data:** Claude Code JSON logs
- **Analysis:** Tiktoken-based token estimation

## 📦 시작하기

### 사전 준비
- [Node.js](https://nodejs.org/) (v18+)
- [Rust](https://www.rust-lang.org/) (latest stable)
- [Yarn](https://yarnpkg.com/)

### 설치 및 실행
1. 저장소 클론 및 의존성 설치:
   \`\`\`bash
   yarn install
   \`\`\`

2. 개발 모드 실행:
   \`\`\`bash
   yarn tauri dev
   \`\`\`

3. 앱 빌드:
   \`\`\`bash
   yarn tauri build
   \`\`\`

## 📂 프로젝트 구조

- \`src/\`: React 프론트엔드 코드
  - \`lib/parser.ts\`: 세션 로그 파싱 로직
  - \`lib/analyzer.ts\`: 토큰 사용 패턴 분석기
  - \`lib/prescriber.ts\`: 최적화 가이드 생성기
- \`src-tauri/\`: Rust 기반 네이티브 설정 및 시스템 호출 처리

## 🔐 보안 및 개인정보

- 모든 분석은 로컬 환경에서 수행됩니다.
- 세션 로그 및 파싱된 데이터는 외부 서버로 전송되지 않습니다.

## 📄 라이선스

MIT License.
