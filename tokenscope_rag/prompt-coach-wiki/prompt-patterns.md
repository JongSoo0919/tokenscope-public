# 좋은 프롬프트 패턴

## 근거 요약

OpenAI는 지시를 프롬프트 앞부분에 두고, 지시와 맥락을 구분자로 분리하며, 원하는 맥락/결과/길이/형식/스타일을 구체적으로 적으라고 권장한다. 또한 모호한 표현 대신 정확한 길이와 형식을 말하고, 원하는 출력 형식을 예시로 보여주는 것이 좋다.

Anthropic은 프롬프트를 개선하기 전에 성공 기준과 평가 방법이 먼저 있어야 한다고 설명한다. 프롬프트 엔지니어링은 모든 문제의 해법이 아니며, 비용과 지연은 모델 선택이나 작업 분리로 해결하는 편이 나을 때도 있다.

Google Gemini 문서는 복잡한 프롬프트를 단순 구성요소로 나누고, 순차 작업은 여러 프롬프트로 체이닝하라고 안내한다.

출처:
- OpenAI Help Center, Best practices for prompt engineering with the OpenAI API: https://help.openai.com/en/articles/6654000-best-practices-for-prompt-engineering-with-openai-api
- Anthropic Claude Docs, Prompt engineering overview: https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/overview
- Google AI for Developers, Prompt design strategies: https://ai.google.dev/gemini-api/docs/prompting-strategies

## 좋은 질문의 기본 구조

좋은 질문은 아래 네 가지를 가진다.

1. 목표: 무엇을 얻고 싶은지
2. 범위: 어디까지 보고 어디는 보지 말아야 하는지
3. 방식: 계획만, 리뷰만, 구현까지, 검증까지 중 무엇인지
4. 완료 조건: 어떤 결과가 나오면 끝인지

예시:

```text
아직 수정하지 말고 /src/api.py만 리뷰해줘.
목표는 FastAPI 엔드포인트 오류 가능성 확인이야.
버그, 예외 처리 누락, 테스트 필요 지점만 최대 5개로 정리해.
스타일 취향이나 대규모 리팩터링 제안은 제외해.
```

## 나쁜 습관

- "전체적으로 봐줘": 파일 탐색 범위가 커지고 목적이 흐려진다.
- "좋게 고쳐줘": 품질 기준이 없어 리팩터링과 기능 변경이 섞인다.
- "왜 안돼?": 에러, 재현 단계, 기대 결과가 없어 반복 질문이 늘어난다.
- "이전 거 이어서": 어떤 결정만 이어받을지 불명확해서 불필요한 과거 맥락이 붙는다.
- "알아서 해": 승인, 삭제, 검증 범위가 불명확해 위험하거나 긴 작업으로 확장된다.

## 재작성 원칙

- 부정 명령만 쓰지 말고 대체 행동을 같이 말한다.
- "짧게"보다 "3개 bullet", "10줄 이하", "파일 경로 포함"처럼 검증 가능한 형식을 쓴다.
- 여러 목적이 섞이면 질문을 기획, 구현, 검증, 리뷰 중 하나로 나눈다.
- 예시 출력이 중요하면 작은 예시를 포함한다.
