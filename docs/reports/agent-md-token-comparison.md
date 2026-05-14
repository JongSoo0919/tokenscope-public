# AI 에이전트 MD 토큰 비교 리포트

Codex와 Claude가 자동 또는 명시적으로 읽을 수 있는 안내 Markdown/TOML 컨텍스트를 대상으로, 적용 전후의 토큰 추정치를 비교했다.

## 핵심 요약

| 항목 | 값 |
| --- | --- |
| 전체 시나리오 적용 전 총 토큰 | 13,091 |
| 전체 시나리오 적용 후 총 토큰 | 5,579 |
| 절감 토큰 | 7,512 |
| 개선율 | 57.4% |
| 가장 큰 개선 시나리오 | Case 09 Claude 하네스 부분 재실행 (1,887토큰 절감) |

## 범위

| 구분 | 내용 |
| --- | --- |
| 적용 전 기준 | product-plan2-action-loop / 925d54d + 작업 전 untracked 파일 바이트 스냅샷 |
| 적용 후 기준 | chore/agent-md-token-report |
| 측정 대상 | `AGENTS.md`, `CLAUDE.md`, `.agents/skills`, `.claude/skills`, `.claude/agents`, `.codex/agents` |
| 시나리오 모델 | Codex/Claude 일반 사용자 요청 10개 |

## 리포팅 기준

- 프롬프트 토큰: 프롬프트 UTF-8 바이트를 `ceil(bytes / 4)`로 추정
- MD 토큰: 읽힌 안내 파일 UTF-8 바이트를 `ceil(bytes / 4)`로 추정
- 총 토큰: 프롬프트 토큰 + MD 토큰
- 읽은 MD 파일: 전역 지침, 호출된 스킬, 호출된 에이전트 정의만 포함
- 개선율: `(적용 전 총 토큰 - 적용 후 총 토큰) / 적용 전 총 토큰`
- 제외 범위: 실제 구현 중 읽는 소스코드, 런타임 모델 내부 시스템 프롬프트, 정확한 vendor token counter

## 요약

| Case | 시나리오 | 적용 전 | 적용 후 | 절감 | 개선율 |
| --- | --- | --- | --- | --- | --- |
| Case 01 | 레포 구조 설명 | 315 | 315 | 0 | 0.0% |
| Case 02 | 세션 로그 파싱 수정 | 1,026 | 570 | 456 | 44.4% |
| Case 03 | 건강 점수 점검 | 1,471 | 603 | 868 | 59.0% |
| Case 04 | AGENTS.md 처방 | 1,460 | 605 | 855 | 58.6% |
| Case 05 | CLAUDE.md 처방 | 1,435 | 580 | 855 | 59.6% |
| Case 06 | 대시보드 UI 수정 | 1,235 | 603 | 632 | 51.2% |
| Case 07 | Claude UI 작업 | 1,207 | 578 | 629 | 52.1% |
| Case 08 | 하네스 전체 재실행 | 1,965 | 635 | 1,330 | 67.7% |
| Case 09 | Claude 하네스 부분 재실행 | 2,654 | 767 | 1,887 | 71.1% |
| Case 10 | PR 본문 작성 | 323 | 323 | 0 | 0.0% |

## MD 파일별 토큰 집계

### 적용 전

| MD 파일 | 사용 횟수 | 1회 토큰 | 총 토큰 | 바이트 |
| --- | --- | --- | --- | --- |
| `.claude/skills/tokenscope-orchestrator/SKILL.md` | 1 | 1,781 | 1,781 | 7,123 |
| `.agents/skills/tokenscope-orchestrator/SKILL.md` | 1 | 1,780 | 1,780 | 7,117 |
| `.claude/agents/prescriber-agent.md` | 2 | 715 | 1,430 | 2,860 |
| `AGENTS.md` | 7 | 161 | 1,127 | 643 |
| `.codex/agents/prescriber-agent.toml` | 1 | 723 | 723 | 2,889 |
| `CLAUDE.md` | 5 | 143 | 715 | 569 |
| `.agents/skills/analyzer-skill/SKILL.md` | 1 | 671 | 671 | 2,683 |
| `.codex/agents/analyzer-agent.toml` | 1 | 618 | 618 | 2,472 |
| `.agents/skills/prescriber-skill/SKILL.md` | 1 | 557 | 557 | 2,227 |
| `.claude/skills/prescriber-skill/SKILL.md` | 1 | 557 | 557 | 2,227 |
| `.codex/agents/ui-agent.toml` | 1 | 542 | 542 | 2,167 |
| `.claude/agents/ui-agent.md` | 1 | 535 | 535 | 2,138 |
| `.agents/skills/ui-skill/SKILL.md` | 1 | 513 | 513 | 2,049 |
| `.claude/skills/ui-skill/SKILL.md` | 1 | 513 | 513 | 2,049 |
| `.agents/skills/parser-skill/SKILL.md` | 1 | 469 | 469 | 1,876 |
| `.codex/agents/parser-agent.toml` | 1 | 374 | 374 | 1,496 |

### 적용 후

| MD 파일 | 사용 횟수 | 1회 토큰 | 총 토큰 | 바이트 |
| --- | --- | --- | --- | --- |
| `AGENTS.md` | 7 | 161 | 1,127 | 643 |
| `CLAUDE.md` | 5 | 143 | 715 | 569 |
| `.agents/skills/tokenscope-orchestrator/SKILL.md` | 1 | 450 | 450 | 1,798 |
| `.claude/skills/tokenscope-orchestrator/SKILL.md` | 1 | 450 | 450 | 1,798 |
| `.claude/agents/prescriber-agent.md` | 2 | 159 | 318 | 635 |
| `.agents/skills/ui-skill/SKILL.md` | 1 | 268 | 268 | 1,071 |
| `.claude/skills/ui-skill/SKILL.md` | 1 | 268 | 268 | 1,071 |
| `.agents/skills/prescriber-skill/SKILL.md` | 1 | 258 | 258 | 1,029 |
| `.claude/skills/prescriber-skill/SKILL.md` | 1 | 258 | 258 | 1,029 |
| `.agents/skills/analyzer-skill/SKILL.md` | 1 | 256 | 256 | 1,023 |
| `.agents/skills/parser-skill/SKILL.md` | 1 | 234 | 234 | 936 |
| `.codex/agents/prescriber-agent.toml` | 1 | 167 | 167 | 665 |
| `.codex/agents/analyzer-agent.toml` | 1 | 165 | 165 | 659 |
| `.codex/agents/ui-agent.toml` | 1 | 155 | 155 | 620 |
| `.codex/agents/parser-agent.toml` | 1 | 153 | 153 | 609 |
| `.claude/agents/ui-agent.md` | 1 | 151 | 151 | 602 |

## 시나리오 상세

### Case 01: 레포 구조 설명

> 이 레포 구조를 간단히 설명해줘.

| 구분 | 프롬프트 토큰 | MD 토큰 | 총 토큰 | 절감 토큰 | 개선율 |
| --- | --- | --- | --- | --- | --- |
| 전후 비교 | 11 | 304 -> 304 | 315 -> 315 | 0 | 0.0% |

#### 적용 전 읽은 MD

| 파일 | 토큰 | 바이트 |
| --- | --- | --- |
| `AGENTS.md` | 161 | 643 |
| `CLAUDE.md` | 143 | 569 |

#### 적용 후 읽은 MD

| 파일 | 토큰 | 바이트 |
| --- | --- | --- |
| `AGENTS.md` | 161 | 643 |
| `CLAUDE.md` | 143 | 569 |

### Case 02: 세션 로그 파싱 수정

> Codex 세션 로그 파싱에서 깨진 JSONL 라인을 건너뛰도록 수정해줘.

| 구분 | 프롬프트 토큰 | MD 토큰 | 총 토큰 | 절감 토큰 | 개선율 |
| --- | --- | --- | --- | --- | --- |
| 전후 비교 | 22 | 1,004 -> 548 | 1,026 -> 570 | 456 | 44.4% |

#### 적용 전 읽은 MD

| 파일 | 토큰 | 바이트 |
| --- | --- | --- |
| `AGENTS.md` | 161 | 643 |
| `.agents/skills/parser-skill/SKILL.md` | 469 | 1,876 |
| `.codex/agents/parser-agent.toml` | 374 | 1,496 |

#### 적용 후 읽은 MD

| 파일 | 토큰 | 바이트 |
| --- | --- | --- |
| `AGENTS.md` | 161 | 643 |
| `.agents/skills/parser-skill/SKILL.md` | 234 | 936 |
| `.codex/agents/parser-agent.toml` | 153 | 609 |

### Case 03: 건강 점수 점검

> 건강 점수 계산 로직이 낭비 패턴을 잘 반영하는지 점검해줘.

| 구분 | 프롬프트 토큰 | MD 토큰 | 총 토큰 | 절감 토큰 | 개선율 |
| --- | --- | --- | --- | --- | --- |
| 전후 비교 | 21 | 1,450 -> 582 | 1,471 -> 603 | 868 | 59.0% |

#### 적용 전 읽은 MD

| 파일 | 토큰 | 바이트 |
| --- | --- | --- |
| `AGENTS.md` | 161 | 643 |
| `.agents/skills/analyzer-skill/SKILL.md` | 671 | 2,683 |
| `.codex/agents/analyzer-agent.toml` | 618 | 2,472 |

#### 적용 후 읽은 MD

| 파일 | 토큰 | 바이트 |
| --- | --- | --- |
| `AGENTS.md` | 161 | 643 |
| `.agents/skills/analyzer-skill/SKILL.md` | 256 | 1,023 |
| `.codex/agents/analyzer-agent.toml` | 165 | 659 |

### Case 04: AGENTS.md 처방

> AGENTS.md가 너무 긴지 분석하고 안전한 수정안을 만들어줘.

| 구분 | 프롬프트 토큰 | MD 토큰 | 총 토큰 | 절감 토큰 | 개선율 |
| --- | --- | --- | --- | --- | --- |
| 전후 비교 | 19 | 1,441 -> 586 | 1,460 -> 605 | 855 | 58.6% |

#### 적용 전 읽은 MD

| 파일 | 토큰 | 바이트 |
| --- | --- | --- |
| `AGENTS.md` | 161 | 643 |
| `.agents/skills/prescriber-skill/SKILL.md` | 557 | 2,227 |
| `.codex/agents/prescriber-agent.toml` | 723 | 2,889 |

#### 적용 후 읽은 MD

| 파일 | 토큰 | 바이트 |
| --- | --- | --- |
| `AGENTS.md` | 161 | 643 |
| `.agents/skills/prescriber-skill/SKILL.md` | 258 | 1,029 |
| `.codex/agents/prescriber-agent.toml` | 167 | 665 |

### Case 05: CLAUDE.md 처방

> CLAUDE.md 컨텍스트를 줄이는 diff와 질문 가이드를 만들어줘.

| 구분 | 프롬프트 토큰 | MD 토큰 | 총 토큰 | 절감 토큰 | 개선율 |
| --- | --- | --- | --- | --- | --- |
| 전후 비교 | 20 | 1,415 -> 560 | 1,435 -> 580 | 855 | 59.6% |

#### 적용 전 읽은 MD

| 파일 | 토큰 | 바이트 |
| --- | --- | --- |
| `CLAUDE.md` | 143 | 569 |
| `.claude/skills/prescriber-skill/SKILL.md` | 557 | 2,227 |
| `.claude/agents/prescriber-agent.md` | 715 | 2,860 |

#### 적용 후 읽은 MD

| 파일 | 토큰 | 바이트 |
| --- | --- | --- |
| `CLAUDE.md` | 143 | 569 |
| `.claude/skills/prescriber-skill/SKILL.md` | 258 | 1,029 |
| `.claude/agents/prescriber-agent.md` | 159 | 635 |

### Case 06: 대시보드 UI 수정

> 대시보드에서 건강 점수 상세 탭과 필터링 UI를 개선해줘.

| 구분 | 프롬프트 토큰 | MD 토큰 | 총 토큰 | 절감 토큰 | 개선율 |
| --- | --- | --- | --- | --- | --- |
| 전후 비교 | 19 | 1,216 -> 584 | 1,235 -> 603 | 632 | 51.2% |

#### 적용 전 읽은 MD

| 파일 | 토큰 | 바이트 |
| --- | --- | --- |
| `AGENTS.md` | 161 | 643 |
| `.agents/skills/ui-skill/SKILL.md` | 513 | 2,049 |
| `.codex/agents/ui-agent.toml` | 542 | 2,167 |

#### 적용 후 읽은 MD

| 파일 | 토큰 | 바이트 |
| --- | --- | --- |
| `AGENTS.md` | 161 | 643 |
| `.agents/skills/ui-skill/SKILL.md` | 268 | 1,071 |
| `.codex/agents/ui-agent.toml` | 155 | 620 |

### Case 07: Claude UI 작업

> Claude 기준으로 FixPreview와 DiffViewer UX를 개선해줘.

| 구분 | 프롬프트 토큰 | MD 토큰 | 총 토큰 | 절감 토큰 | 개선율 |
| --- | --- | --- | --- | --- | --- |
| 전후 비교 | 16 | 1,191 -> 562 | 1,207 -> 578 | 629 | 52.1% |

#### 적용 전 읽은 MD

| 파일 | 토큰 | 바이트 |
| --- | --- | --- |
| `CLAUDE.md` | 143 | 569 |
| `.claude/skills/ui-skill/SKILL.md` | 513 | 2,049 |
| `.claude/agents/ui-agent.md` | 535 | 2,138 |

#### 적용 후 읽은 MD

| 파일 | 토큰 | 바이트 |
| --- | --- | --- |
| `CLAUDE.md` | 143 | 569 |
| `.claude/skills/ui-skill/SKILL.md` | 268 | 1,071 |
| `.claude/agents/ui-agent.md` | 151 | 602 |

### Case 08: 하네스 전체 재실행

> TokenScope 하네스를 이전 결과 기반으로 다시 실행하고 누락을 보완해줘.

| 구분 | 프롬프트 토큰 | MD 토큰 | 총 토큰 | 절감 토큰 | 개선율 |
| --- | --- | --- | --- | --- | --- |
| 전후 비교 | 24 | 1,941 -> 611 | 1,965 -> 635 | 1,330 | 67.7% |

#### 적용 전 읽은 MD

| 파일 | 토큰 | 바이트 |
| --- | --- | --- |
| `AGENTS.md` | 161 | 643 |
| `.agents/skills/tokenscope-orchestrator/SKILL.md` | 1,780 | 7,117 |

#### 적용 후 읽은 MD

| 파일 | 토큰 | 바이트 |
| --- | --- | --- |
| `AGENTS.md` | 161 | 643 |
| `.agents/skills/tokenscope-orchestrator/SKILL.md` | 450 | 1,798 |

### Case 09: Claude 하네스 부분 재실행

> Claude 하네스에서 prescriber 단계만 재실행해줘.

| 구분 | 프롬프트 토큰 | MD 토큰 | 총 토큰 | 절감 토큰 | 개선율 |
| --- | --- | --- | --- | --- | --- |
| 전후 비교 | 15 | 2,639 -> 752 | 2,654 -> 767 | 1,887 | 71.1% |

#### 적용 전 읽은 MD

| 파일 | 토큰 | 바이트 |
| --- | --- | --- |
| `CLAUDE.md` | 143 | 569 |
| `.claude/skills/tokenscope-orchestrator/SKILL.md` | 1,781 | 7,123 |
| `.claude/agents/prescriber-agent.md` | 715 | 2,860 |

#### 적용 후 읽은 MD

| 파일 | 토큰 | 바이트 |
| --- | --- | --- |
| `CLAUDE.md` | 143 | 569 |
| `.claude/skills/tokenscope-orchestrator/SKILL.md` | 450 | 1,798 |
| `.claude/agents/prescriber-agent.md` | 159 | 635 |

### Case 10: PR 본문 작성

> 현재 변경사항 기준으로 PR 본문과 검증 결과를 정리해줘.

| 구분 | 프롬프트 토큰 | MD 토큰 | 총 토큰 | 절감 토큰 | 개선율 |
| --- | --- | --- | --- | --- | --- |
| 전후 비교 | 19 | 304 -> 304 | 323 -> 323 | 0 | 0.0% |

#### 적용 전 읽은 MD

| 파일 | 토큰 | 바이트 |
| --- | --- | --- |
| `AGENTS.md` | 161 | 643 |
| `CLAUDE.md` | 143 | 569 |

#### 적용 후 읽은 MD

| 파일 | 토큰 | 바이트 |
| --- | --- | --- |
| `AGENTS.md` | 161 | 643 |
| `CLAUDE.md` | 143 | 569 |

## 적용 변경

- Cursor 전용 계획을 Codex/Claude 중심의 AI 에이전트 안내 컨텍스트 최적화 계획으로 변경했다.
- `.agents/skills`와 `.claude/skills`의 중복 장문 설명을 역할, 입력, 출력, 실패 처리 중심으로 압축했다.
- `.claude/agents`와 `.codex/agents` 정의에서 긴 예시와 반복 설명을 제거했다.
- 전역 파일은 이미 작아 유지하고, 스킬/에이전트 문서 중복을 주요 병목으로 처리했다.

## 해석

이번 개선은 자동/명시 호출 가능성이 높은 지침 파일을 줄이는 데 초점을 맞췄다. 실제 Codex/Claude 내부 token counter가 아니라 동일한 로컬 추정식을 사용했으므로 절대 토큰 수는 근사치다. 다만 전후 비교에는 같은 계산식을 적용했기 때문에 상대 개선율은 병목 감소 방향을 판단하는 기준으로 사용할 수 있다.

