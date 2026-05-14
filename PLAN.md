# Codex/Claude MD 토큰 최적화 계획

현재 레포에서 Codex와 Claude가 자동 또는 명시적으로 읽을 수 있는 Markdown/TOML 안내 컨텍스트의 토큰 병목을 분석하고, 적용 전/후 비교 리포트를 작성한다.

## 목표

- 일반 사용자가 자주 쓸 법한 Codex/Claude 프롬프트 시나리오를 만든다.
- 각 시나리오에서 어떤 안내 파일이 자동/명시적으로 읽힐지 산정한다.
- 파일별 토큰 소모량, 시나리오별 총 토큰 소모량, 전/후 개선율을 표로 리포팅한다.
- 긴 전역 지침과 중복 스킬/에이전트 문서를 줄여 일반 사용자 컨텍스트를 가볍게 만든다.
- 적용 후 같은 기준으로 다시 측정해 개선량을 비교한다.

## 작업 방식

1. 작업 브랜치를 만든다.
   - 기본 브랜치명: `chore/agent-md-token-report`
2. Codex/Claude 관련 안내 파일을 확인한다.
   - `AGENTS.md`
   - `CLAUDE.md`
   - `.agents/skills/**/SKILL.md`
   - `.codex/agents/*.toml`
   - `.claude/agents/*.md`
   - `.claude/skills/**/SKILL.md`
   - 제품 문서 중 명시적으로 참조될 수 있는 `README.md`, `PRODUCT_PLAN*.md`, `V2_PLAN.md`, `DESIGN.md`
3. 적용 전 기준을 명시한다.
   - 기준 브랜치명과 기준 SHA
   - untracked 파일은 작업 전 바이트 스냅샷을 기준으로 삼는다.
4. 일반 사용자 관점의 프롬프트 시나리오를 최소 10개 작성한다.
   - 레포 구조 설명
   - 세션 로그 파싱 버그 수정
   - 건강 점수 계산 로직 점검
   - AGENTS.md/CLAUDE.md 처방 생성
   - 질문 가이드 개선
   - 대시보드 UI 수정
   - Tauri 파일 접근 흐름 점검
   - 테스트/검증 명령 정리
   - PR 본문 작성
   - TokenScope 하네스 재실행/부분 재실행
5. 각 시나리오별로 읽힌 안내 파일을 산정한다.
   - Codex: `AGENTS.md`, 호출된 `.agents/skills/**/SKILL.md`, 필요한 `.codex/agents/*.toml`
   - Claude: `CLAUDE.md`, 호출된 `.claude/skills/**/SKILL.md`, 필요한 `.claude/agents/*.md`
   - 명시적으로 요청된 제품 문서
   - 실제 구현 중 열람하는 소스코드 파일은 제외한다.
6. 토큰 산정 방식을 명시한다.
   - 내부 런타임 token counter를 직접 확인할 수 없으면 `ceil(utf8_bytes / 4)` 추정식을 사용한다.
   - 전/후를 같은 방식으로 계산한다.
7. 병목을 줄이는 적용안을 만든다.
   - 전역 파일은 프로젝트 목표, 트리거, 실행 방법만 유지한다.
   - 스킬/에이전트 문서는 역할, 입력, 출력, 실패 처리, 검증만 남긴다.
   - 동일 내용의 장문 설명과 예시는 반복하지 않는다.
   - 도구별 문서는 도구별 차이가 있는 경우에만 다르게 둔다.
8. 적용 후 같은 시나리오와 산정 방식으로 다시 측정한다.
9. 리포트를 Markdown으로 작성한다.

## 리포트 파일

- `docs/reports/agent-md-token-comparison.md`

## 필수 섹션

1. `# AI 에이전트 MD 토큰 비교 리포트`
2. 목적 설명
3. `## 핵심 요약`
4. `## 범위`
5. `## 리포팅 기준`
6. `## 요약`
7. `## MD 파일별 토큰 집계`
8. `## 시나리오 상세`
9. `## 적용 변경`
10. `## 해석`

## 검증

- 리포트 생성 스크립트 문법 검증
- 리포트 생성 실행
- `git diff --check`

## 최종 보고

- 생성/수정한 파일 목록
- 핵심 개선 수치
- 검증 명령과 결과
- Codex/Claude 내부 exact token counter를 사용하지 못한 한계
