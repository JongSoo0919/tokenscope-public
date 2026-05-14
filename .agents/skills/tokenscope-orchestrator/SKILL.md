---
name: tokenscope-orchestrator
description: TokenScope 하네스 오케스트레이터. 토큰 낭비, 건강 점수, AGENTS.md/CLAUDE.md 수정, 미리보기, 대시보드, 질문 가이드, 필터링, 상세 탭 요청 시 사용합니다.
---

# TokenScope Orchestrator

## 역할
세션 분석부터 처방, UI 반영, 검증까지 TokenScope 작업을 조율한다.

## 실행 판단
- `_workspace/` 없음: 초기 실행
- `_workspace/` 있음 + 새 입력: 새 실행, 이전 결과 보존
- `_workspace/` 있음 + 부분 수정 요청: 해당 단계만 재실행

## 단계
| 단계 | 담당 | 산출물 |
|---|---|---|
| 1. 파싱 | parser | `_workspace/01_parsed_sessions.json` |
| 2. 분석 | analyzer | `_workspace/02_analyzed_sessions.json` |
| 3. 처방 | prescriber | `_workspace/03_prescriptions.json` |
| 4. UI | ui | 관련 React 컴포넌트 |
| 5. 통합 검증 | orchestrator | 테스트 결과와 누락 목록 |

## 작업 원칙
- 세부 지침은 필요한 스킬 파일만 읽는다.
- 상충 데이터는 삭제하지 않고 출처를 병기한다.
- 1회 재시도 후 실패하면 해당 결과 없이 진행하고 보고서에 누락을 남긴다.
- 실제 지침 파일 수정은 백업과 diff 확인을 전제로 한다.

## 정상 흐름
앱 시작 -> 세션 선택 -> 진단 결과 -> 상세/미리보기 -> 승인 적용 -> 대시보드 갱신.

## 오류 흐름
| 상황 | 처리 |
|---|---|
| 지침 파일 없음 | `CONTEXT_BLOAT` skip |
| 세션 파싱 실패 | 해당 세션 skip + 경고 |
| 백업 실패 | 수정 중단 |
| UI 렌더 실패 | 오류 상태와 재시도 표시 |

## 후속 요청
"다시 실행", "재실행", "업데이트", "수정", "보완", "이전 결과 기반" 요청은 기존 `_workspace/` 산출물을 먼저 확인한다.
