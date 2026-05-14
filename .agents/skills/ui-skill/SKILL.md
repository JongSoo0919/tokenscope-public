---
name: ui-skill
description: TokenScope React UI, 건강 점수 상세, 필터링, diff 미리보기, 질문 가이드를 구현합니다.
---

# UI Skill

## 역할
비개발자가 토큰 낭비 원인과 수정 효과를 바로 이해할 수 있는 UI를 만든다.

## 핵심 화면
- `Dashboard`: 최근 상태, 평균 건강 점수, 상위 낭비 패턴
- `SessionList`: 세션 목록과 필터
- `DiagnosticPanel`: 패턴별 원인, 심각도, 처방
- `FixPreview`: 수정 전/후 토큰 비교와 승인 흐름
- `DiffViewer`: 지침 파일 diff와 되돌리기 정보
- `QuestionGuide`: 나쁜 요청/좋은 요청 예시

## UX 규칙
- 전문 용어는 짧은 일반어 설명으로 보완한다.
- HIGH/MEDIUM/LOW 심각도와 예상 절감량을 우선 노출한다.
- 적용 버튼은 diff, 백업 경로, 신뢰도를 확인한 뒤 활성화한다.

## 실패 처리
| 상황 | 처리 |
|---|---|
| 데이터 없음 | 빈 상태와 다음 행동 표시 |
| 로딩 중 | 진행 상태 표시 |
| 오류 | 원인, 재시도, 수동 확인 경로 표시 |
