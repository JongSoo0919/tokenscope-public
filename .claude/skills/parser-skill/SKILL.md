---
name: parser-skill
description: JSONL 파일 파싱, 스키마 검증, 세션 데이터 구조화. Claude Code 세션 로그를 읽고 구조화된 데이터로 변환합니다. JSONL 읽기, 파싱, 캐시 관리, 증분 파싱을 수행합니다.
---

# Parser Skill

## 개요
Claude Code 세션 로그(JSONL)를 읽고 구조화된 데이터로 변환합니다.

## 작업 원칙
1. **스키마 안정성 우선** — JSONL 포맷이 변경될 수 있음을 인지하고, 파싱 실패 시 명확한 에러 메시지 제공
2. **증분 파싱** — 캐시를 활용하여 변경된 세션만 재파싱
3. **에러 복구** — 손상된 JSONL 라인은 skip하고 경고 로그

## JSONL 구조

### System message
```json
{ "role": "system", "content": "...", "usage": { "input_tokens": N } }
```

### User message
```json
{ "role": "user", "content": "...", "usage": { "input_tokens": N } }
```

### Assistant message
```json
{ "role": "assistant", "content": "...",
  "usage": { "input_tokens": N, "output_tokens": N, "cache_read_input_tokens": N } }
```

### Tool use
```json
{ "role": "assistant", "content": [{ "type": "tool_use", "id": "...", "name": "Bash", "input": {...} }],
  "usage": { "input_tokens": N, "output_tokens": N } }
```

### Tool result
```json
{ "role": "user", "content": [{ "type": "tool_result", "tool_use_id": "...",
  "content": "...", "is_error": false }],
  "usage": { "input_tokens": N } }
```

## 캐시 전략
- 파싱 결과를 `~/.tokenscope/cache/{session-hash}.json`에 저장
- 파일 mtime 비교로 변경된 세션만 재파싱
- 앱 시작 시 최근 30일치만 자동 로드

## 에러 핸들링
| 에러 상황 | 처리 방법 |
|----------|----------|
| JSON 파싱 실패 | 해당 라인 skip + 경고 로그 |
| 필드 누락 | 기본값 사용 + 경고 로그 |
| 포맷 변경 감지 | "로그 포맷 변경 감지됨" 알림 |
