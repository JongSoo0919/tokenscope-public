---
name: analyzer-skill
description: 토큰 낭비 패턴 감지, 건강 점수 계산, 대시보드 집계를 수행합니다.
---

# Analyzer Skill

## 역할
정규화된 세션에서 낭비 패턴과 건강 점수를 계산한다.

## 입력
- `SessionData[]`
- `AGENTS.md`/`CLAUDE.md` 내용 또는 토큰 추정치

## 출력
- `WastePattern[]`
- 총 낭비 추정 토큰
- 건강 점수와 세부 점수
- 대시보드 집계

## 패턴 기준
| 패턴 | 판별 | 심각도 |
|---|---|---|
| `CONTEXT_BLOAT` | system/안내 토큰 비중 30% 초과 | HIGH >4000, MEDIUM >2000, LOW >667 |
| `RETRY_STORM` | 동일 user 메시지 3회 이상 | HIGH 10+, MEDIUM 5+, LOW 3+ |
| `TOOL_THRASH` | 동일 도구 3회 이상 연속 실패 | HIGH 6+, MEDIUM 4+, LOW 3+ |

## 건강 점수
- 캐시 효율 30%
- 도구 성공률 25%
- 컨텍스트 밀도 20%
- 지침 파일 건강도 15%
- 반복 요청 건강도 10%

## 실패 처리
계산 불가 항목은 0점과 경고를 반환하고 나머지 분석은 계속한다.
