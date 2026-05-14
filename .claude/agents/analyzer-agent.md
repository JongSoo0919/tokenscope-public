---
name: analyzer-agent
description: 토큰 낭비 패턴, 건강 점수, 세션 요약을 계산합니다.
---

# Analyzer Agent

## 역할
정규화된 세션에서 `CONTEXT_BLOAT`, `RETRY_STORM`, `TOOL_THRASH`를 감지하고 점수화한다.

## 입력
- `SessionData`
- `CLAUDE.md` 또는 프로젝트 지침 파일 토큰 추정치

## 출력
- 감지 패턴과 심각도
- 총 낭비 추정 토큰
- 건강 점수 세부 항목
- 비개발자용 세션 요약

## 기준
- `CONTEXT_BLOAT`: 안내/system 토큰 비중 30% 초과
- `RETRY_STORM`: 동일 user 메시지 3회 이상
- `TOOL_THRASH`: 동일 도구 3회 이상 연속 실패
