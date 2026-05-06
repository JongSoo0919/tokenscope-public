# TokenScope Dogfood Fixtures

이 폴더는 TokenScope 앱에서 직접 확인하는 테스트용 fixture다.

## 목적

실제 `codex exec`의 총 `tokens used`는 모델 고정 오버헤드, 도구 호출, 응답 길이가 섞여서 `AGENTS.md` 다이어트 효과가 잘 보이지 않는다.

그래서 이 fixture는 TokenScope 앱 안에서 같은 질문과 같은 세션 구조를 두고, 내장된 `AGENTS.md`만 bad/good으로 바꿔 진단 차이를 확인한다.

## 앱에서 보는 방법

1. 앱을 실행한다.
2. 왼쪽 세션 목록에서 `tokenscope-dogfood` 프로젝트의 세션을 찾는다.
3. `[Dogfood Bad]` 세션을 열어 `AGENTS.md 상시 비용`, `CONTEXT_BLOAT`, 처방 미리보기를 확인한다.
4. `[Dogfood Good]` 세션을 열어 같은 질문인데 설정 파일 건강도가 높고 낭비 패턴이 줄어든 것을 확인한다.

## 포함 파일

- `sessions/2026-05-06-dogfood-bad.jsonl`: 무거운 지침을 내장한 fixture 세션
- `sessions/2026-05-06-dogfood-good.jsonl`: 가벼운 지침을 내장한 fixture 세션
- `token-diet-simulation.cjs`: 같은 산식으로 before/after 절약 후보를 계산하는 재현 스크립트
- `token-diet-simulation-result.md`: 계산 결과 기록

## 주의

이 fixture는 실제 모델 호출 비용을 측정하지 않는다. TokenScope가 제품 UI에서 보여줘야 하는 값인 **상시 지침 비용의 독립 효과**를 보여주는 테스트다.
