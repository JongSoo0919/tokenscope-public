# TokenScope AGENTS.md 처방 효과 시뮬레이션

실행일: 2026-05-06

## 목적

실제 `codex exec`의 총 `tokens used`는 모델 고정 오버헤드, 도구 호출, 응답 길이, 세션 메타 컨텍스트가 섞여서 `AGENTS.md` 다이어트 효과가 잘 보이지 않는다.

그래서 이번 테스트는 TokenScope가 제품에서 보여줘야 하는 값인 **상시 지침 비용 before/after**만 분리해서 측정했다.

## 산식

TokenScope 현재 추정식과 동일하게 계산했다.

```ts
Math.ceil(text.length / 3)
```

실행 명령:

```bash
node dogfood/token-diet-simulation.cjs
```

## 결과 1: 현실적인 중간 규모 bad 지침

- 동일 사용자 질문 추정: 29 tokens
- Bad AGENTS.md 상시 비용: 594 tokens
- Good AGENTS.md 상시 비용: 30 tokens
- 요청 1회당 절약 후보: 564 tokens
- 상시 지침 절약률: 94.9%
- Bad 설정 파일 건강도: 80점
- Good 설정 파일 건강도: 99점

| 턴 수 | Before tokens | After tokens | Saved tokens | Saved rate |
|---:|---:|---:|---:|---:|
| 1 | 623 | 59 | 564 | 90.5% |
| 5 | 3,115 | 295 | 2,820 | 90.5% |
| 12 | 7,476 | 708 | 6,768 | 90.5% |
| 30 | 18,690 | 1,770 | 16,920 | 90.5% |

## 결과 2: 데모용 amplified bad 지침

- 동일 사용자 질문 추정: 29 tokens
- Bad AGENTS.md 상시 비용: 11,286 tokens
- Good AGENTS.md 상시 비용: 30 tokens
- 요청 1회당 절약 후보: 11,256 tokens
- 상시 지침 절약률: 99.7%
- Bad 설정 파일 건강도: 0점
- Good 설정 파일 건강도: 99점

| 턴 수 | Before tokens | After tokens | Saved tokens | Saved rate |
|---:|---:|---:|---:|---:|
| 1 | 11,315 | 59 | 11,256 | 99.5% |
| 5 | 56,575 | 295 | 56,280 | 99.5% |
| 12 | 135,780 | 708 | 135,072 | 99.5% |
| 30 | 339,450 | 1,770 | 337,680 | 99.5% |

## 해석

이 테스트는 실제 모델 호출 비용을 측정한 것이 아니라, TokenScope 처방 화면이 보여줘야 할 **상시 지침 비용의 독립 효과**를 분리한 것이다.

실제 `codex exec` 총량 비교가 직관적이지 않았던 이유:

- 총량에는 모델/CLI 고정 오버헤드가 섞인다.
- 도구 호출 횟수와 응답 길이가 매 실행마다 달라진다.
- 기존 bad fixture가 594 tokens 수준이라 17k 이상 총량 안에서 차이가 묻혔다.

제품 UI에서는 아래처럼 보여주는 편이 더 직관적이다.

```text
현재 AGENTS.md 상시 비용: 11,286 tokens
처방 후 상시 비용: 30 tokens
동일 요청 12턴 기준 절약 후보: 135,072 tokens
```

## 결론

TokenScope의 처방 효과 검증은 실제 모델 호출 총량이 아니라 `AGENTS.md` 상시 비용을 독립 변수로 고정한 before/after 시뮬레이션이 더 적합하다.

실제 모델 호출은 보조 검증으로만 사용하고, 제품의 핵심 지표는 "요청 1회당 상시 지침 절약 후보"와 "최근 5시간/턴 수 기준 누적 절약 후보"로 표시해야 한다.
