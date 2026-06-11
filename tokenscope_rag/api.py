#!/usr/bin/env python3
"""TokenScope-owned RAG API wrapper.

The generic RAG implementation lives in the `rag/` submodule. TokenScope-specific
prompt coaching endpoints and knowledge live in this package so the submodule can
track upstream without carrying product-specific code.
"""

import os
import sys
import json
import sqlite3
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAG_ROOT = ROOT / "rag"
if str(RAG_ROOT) not in sys.path:
    sys.path.insert(0, str(RAG_ROOT))

os.chdir(RAG_ROOT)

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from langchain_chroma import Chroma
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import PromptTemplate
from langchain_core.runnables import RunnablePassthrough
from pydantic import BaseModel

from src.chain import build_rag_chain, format_docs
from src.config import Settings, load_settings
from src.loader import load_and_chunk_wiki
from src.providers import create_embeddings, create_llm
from src.providers.ollama_health import validate_ollama_models
from src.vectorstore import build_or_load_vectorstore, get_retriever
from tokenscope_rag.session_log import log_wiki_exchange
from tokenscope_rag.provider_qa_log import log_provider_qa, read_provider_qa_history

from tokenscope_rag.external_provider import (
    ExternalLLMProvider,
    create_external_provider,
)
from tokenscope_rag.route_logger import RouteLogger
import tokenscope_rag.router as router

PROMPT_COACH_WIKI_DIR = ROOT / "tokenscope_rag" / "prompt-coach-wiki"
PROMPT_COACH_PERSIST_DIR = ROOT / "tokenscope_rag" / ".chroma-prompt-coach"
IGNORED_SESSION_FILES = {
    "logs.json",
    "projects.json",
    "settings.json",
    "state.json",
    "hud-state.json",
    "oauth_creds.json",
}

# ---------------------------------------------------------------------------
# Globals set during lifespan startup
# ---------------------------------------------------------------------------
_chain = None
_coach_chain = None
_coach_direct_chain = None       # accepts pre-fetched context (no retriever)
_provider_qa_chain = None
_coach_vectorstore: Chroma | None = None
_external_provider: ExternalLLMProvider | None = None
_route_logger: RouteLogger = RouteLogger()
_settings: Settings | None = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _embed_label(settings: Settings) -> str:
    if settings.embed_provider == "ollama":
        return settings.ollama_embed_model
    if settings.embed_provider == "huggingface":
        return settings.hf_embed_model
    return "unknown"


def _embed_meta_path(persist_dir: str | Path) -> Path:
    return Path(persist_dir) / ".embed_model"


def _needs_rebuild(settings: Settings, persist_path: Path, persist_dir: str | Path) -> bool:
    if not persist_path.exists() or not any(persist_path.iterdir()):
        return True
    meta_path = _embed_meta_path(persist_dir)
    if not meta_path.exists():
        return True
    current = f"{settings.embed_provider}:{_embed_label(settings)}"
    stored = meta_path.read_text(encoding="utf-8").strip()
    return stored != current


def _save_embed_meta(settings: Settings, persist_dir: str | Path) -> None:
    meta_path = _embed_meta_path(persist_dir)
    meta_path.write_text(
        f"{settings.embed_provider}:{_embed_label(settings)}",
        encoding="utf-8",
    )


def _resolve_internal_model_name(settings: Settings) -> str:
    provider = settings.llm_provider
    if provider == "ollama":
        return settings.ollama_llm_model
    if provider == "openai":
        return settings.openai_llm_model
    if provider == "cursor":
        return settings.cursor_model
    if provider == "huggingface":
        return settings.hf_llm_model
    return provider


def _source_from_docs(docs) -> list[str]:
    """Extract relative source paths from retrieved document metadata."""
    seen: set[str] = set()
    result: list[str] = []
    for doc in docs:
        raw = doc.metadata.get("source", "")
        if not raw:
            continue
        # Make the path relative to the project root for cleaner display
        try:
            rel = str(Path(raw).relative_to(ROOT))
        except ValueError:
            rel = raw
        if rel not in seen:
            seen.add(rel)
            result.append(rel)
    return result


# ---------------------------------------------------------------------------
# Prompt-coach chain builders
# ---------------------------------------------------------------------------

_COACH_PROMPT_TEMPLATE = """당신은 AI 코딩 세션과 토큰 사용을 개선하는 한국어 프롬프트 코치입니다.
아래 코칭 지식만 근거로 사용자의 질문 습관을 진단하고, 다음에 더 잘 물어볼 문장을 제안하세요.
근거에 없는 내용을 과장하지 말고, 사용자의 목적은 보존하세요.
반드시 한국어로만 답하세요. 영어 문장, 영어 제목, 영어 설명을 쓰지 마세요.
코드 식별자나 파일명처럼 번역하면 안 되는 짧은 고유명사만 원문을 유지할 수 있습니다.

코칭 지식:
{context}

분석할 입력:
{question}

반드시 아래 형식으로 답하세요.

요약:
<현재 질문 또는 세션 의도 한 문장>

왜 모호한가:
- <대상, 범위, 완료 조건, 제외 조건 중 부족한 점>
- <이 모호함이 탐색/반복/도구 호출을 늘리는 이유>

다음에는 이렇게 질문하세요:
<사용자가 그대로 복사해 쓸 수 있는 개선 질문>

개선된 점:
- <개선 질문이 원래 질문보다 구체적인 점>
- <작업 범위나 검증 기준이 더 명확해진 점>

토큰 절약 포인트:
- <왜 이 질문이 더 적은 탐색/반복을 만드는지>
- 예상 절약: <TokenScope 예상 절약 토큰이 있으면 그 값을 사용하고, 없으면 보수적인 범위를 한국어로 제시>
"""


def build_prompt_coach_chain(retriever, llm: BaseChatModel):
    """Build a TokenScope prompt-coach RAG chain (retriever-based)."""
    prompt = PromptTemplate(
        template=_COACH_PROMPT_TEMPLATE,
        input_variables=["context", "question"],
    )
    chain = (
        {
            "context": retriever | format_docs,
            "question": RunnablePassthrough(),
        }
        | prompt
        | llm
        | StrOutputParser()
    )
    return chain, retriever


def build_prompt_coach_direct_chain(llm: BaseChatModel):
    """Build a prompt-coach chain that accepts pre-fetched context.

    Input must be a dict: {"context": str, "question": str}.
    This avoids a second vectorstore retrieval when the router has already
    fetched the documents.
    """
    prompt = PromptTemplate(
        template=_COACH_PROMPT_TEMPLATE,
        input_variables=["context", "question"],
    )
    return prompt | llm | StrOutputParser()


_PROVIDER_QA_PROMPT_TEMPLATE = """당신은 TokenScope의 세션 분석 도우미입니다.
아래는 사용자가 선택한 provider 범위에서 수집한 최근 세션의 질문/답변/스코프 신호입니다.
반드시 한국어로만 답하고, 제공된 근거 밖의 사실은 단정하지 마세요.
질문에 답하면서 다음을 함께 요약하세요.
- 반복되는 작업 주제
- 스코프가 넓어지거나 섞이는 패턴
- 자주 등장하는 파일/기능/키워드
- 답변이 불확실한 경우 그 이유

provider 범위:
{provider}

스코프 요약:
{scope_summary}

세션 근거:
{context}

사용자 질문:
{question}

아래 형식으로만 답하세요.

답변:
<질문에 대한 핵심 답변>

스코프:
- <반복되는 주제 또는 범위 신호>
- <혼선 또는 과도한 확장 신호>
- <주의할 점>

참고:
- <필요한 경우 근거가 된 세션 특징>
"""


def build_provider_qa_chain(llm: BaseChatModel):
    prompt = PromptTemplate(
        template=_PROVIDER_QA_PROMPT_TEMPLATE,
        input_variables=["provider", "scope_summary", "context", "question"],
    )
    return prompt | llm | StrOutputParser()


# ---------------------------------------------------------------------------
# Lifespan
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    global _chain, _coach_chain, _coach_direct_chain, _provider_qa_chain
    global _coach_vectorstore, _external_provider, _settings

    print("Initializing TokenScope RAG system...")
    settings = load_settings()
    _settings = settings

    validate_ollama_models(settings)
    embeddings = create_embeddings(settings)
    llm = create_llm(settings)

    # Generic wiki vectorstore
    persist_path = Path(settings.persist_dir)
    if _needs_rebuild(settings, persist_path, settings.persist_dir):
        print("Loading wiki documents and building vectorstore...")
        docs = load_and_chunk_wiki(settings.wiki_dir)
        vectorstore = build_or_load_vectorstore(
            docs=docs,
            embeddings=embeddings,
            persist_dir=settings.persist_dir,
            rebuild=True,
        )
        _save_embed_meta(settings, settings.persist_dir)
    else:
        print("Using cached vectorstore...")
        vectorstore = build_or_load_vectorstore(
            docs=None,
            embeddings=embeddings,
            persist_dir=settings.persist_dir,
        )

    retriever = get_retriever(vectorstore, k=3)
    _chain, _ = build_rag_chain(
        retriever=retriever,
        llm=llm,
        response_language=settings.response_language,
    )

    # Prompt-coach vectorstore
    coach_persist_path = Path(PROMPT_COACH_PERSIST_DIR)
    if _needs_rebuild(settings, coach_persist_path, PROMPT_COACH_PERSIST_DIR):
        print("Loading TokenScope prompt coach wiki and building vectorstore...")
        coach_docs = load_and_chunk_wiki(str(PROMPT_COACH_WIKI_DIR))
        coach_vectorstore = build_or_load_vectorstore(
            docs=coach_docs,
            embeddings=embeddings,
            persist_dir=str(PROMPT_COACH_PERSIST_DIR),
            rebuild=True,
        )
        _save_embed_meta(settings, PROMPT_COACH_PERSIST_DIR)
    else:
        print("Using cached TokenScope prompt coach vectorstore...")
        coach_vectorstore = build_or_load_vectorstore(
            docs=None,
            embeddings=embeddings,
            persist_dir=str(PROMPT_COACH_PERSIST_DIR),
        )

    coach_retriever = get_retriever(coach_vectorstore, k=5)
    _coach_chain, _ = build_prompt_coach_chain(
        retriever=coach_retriever,
        llm=llm,
    )
    _coach_direct_chain = build_prompt_coach_direct_chain(llm)
    _provider_qa_chain = build_provider_qa_chain(llm)
    _coach_vectorstore = coach_vectorstore

    # External provider (optional — gracefully disabled if credentials missing)
    _external_provider = create_external_provider(settings)
    if _external_provider:
        print(f"[HybridRouter] External provider ready: {_external_provider.model_name}")
    else:
        print("[HybridRouter] No external provider configured — external routes fall back to internal.")

    print("TokenScope RAG system ready.")
    yield


# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------

app = FastAPI(title="TokenScope RAG API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------

class AskRequest(BaseModel):
    question: str


class AskResponse(BaseModel):
    answer: str


class SessionFileResponse(BaseModel):
    session_id: str
    project: str
    path: str
    size_bytes: int
    modified: int


class ReadSessionRequest(BaseModel):
    path: str


class ReadSessionResponse(BaseModel):
    content: str
    path: str


class CoachPromptRequest(BaseModel):
    question: str
    session_summary: str | None = None
    project: str | None = None
    provider: str | None = None
    patterns: list[str] = []
    recent_user_messages: list[str] = []
    score_breakdown: dict[str, float] | None = None
    ambiguity_reason: str | None = None
    expected_improvement: str | None = None
    estimated_saved_tokens: int | None = None
    candidate_score: float | None = None


class CoachPromptResponse(BaseModel):
    advice: str
    route: str = "internal"        # "internal" | "external"
    model: str = "ollama"          # model name that generated the answer
    source: list[str] = []         # wiki files used (empty for external routes)
    max_score: float = 0.0         # highest relevance score from vectorstore


class ProviderQaRequest(BaseModel):
    provider: str = "all"
    question: str


class ProviderQaResponse(BaseModel):
    answer: str
    provider: str
    sessions_used: int
    sources: list[str] = []
    scope_summary: str = ""


class ProviderQaHistoryItem(BaseModel):
    timestamp: str
    provider: str
    question: str
    answer: str
    sessions_used: int
    sources: list[str] = []
    scope_summary: str = ""


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.get("/")
async def root():
    return {"message": "TokenScope RAG API is running. POST /ask or /coach-prompt to query."}


@app.get("/tokenscope/sessions", response_model=list[SessionFileResponse])
async def list_tokenscope_sessions():
    sessions = _list_local_sessions()
    sessions.sort(key=lambda session: session.modified, reverse=True)

    seen = set()
    unique = []
    for session in sessions:
        if session.path in seen:
            continue
        seen.add(session.path)
        unique.append(session)
    return unique


@app.post("/tokenscope/read-session", response_model=ReadSessionResponse)
async def read_tokenscope_session(req: ReadSessionRequest):
    path = Path(req.path).resolve()
    if not _is_allowed_session_path(path):
        raise HTTPException(status_code=404, detail="session not found")

    if _is_cursor_chat_store(path):
        content = _read_cursor_store_as_jsonl(path)
    elif _is_cursor_state_db(path):
        content = _read_cursor_state_as_jsonl(path)
    else:
        content = path.read_text(encoding="utf-8")

    return ReadSessionResponse(content=content, path=str(path))


@app.post("/ask", response_model=AskResponse)
async def ask(req: AskRequest):
    if not req.question.strip():
        raise HTTPException(status_code=400, detail="question must not be empty")
    if _chain is None:
        raise HTTPException(status_code=503, detail="RAG chain not initialized")

    answer = _chain.invoke(req.question)
    log_wiki_exchange(
        question=req.question.strip(),
        answer=answer,
        model=settings_model_label(),
        provider=settings_provider_label(),
        wiki_dir=settings_wiki_dir(),
    )
    return AskResponse(answer=answer)


@app.post("/ask/stream")
async def ask_stream(req: AskRequest):
    if not req.question.strip():
        raise HTTPException(status_code=400, detail="question must not be empty")
    if _chain is None:
        raise HTTPException(status_code=503, detail="RAG chain not initialized")

    def token_generator():
        chunks = []
        started_at = datetime.now(timezone.utc).isoformat()
        for token in _chain.stream(req.question):
            chunks.append(str(token))
            yield f"data: {token}\n\n"
        log_wiki_exchange(
            question=req.question.strip(),
            answer="".join(chunks),
            model=settings_model_label(),
            provider=settings_provider_label(),
            wiki_dir=settings_wiki_dir(),
            started_at=started_at,
        )
        yield "data: [DONE]\n\n"

    return StreamingResponse(token_generator(), media_type="text/event-stream")


@app.post("/coach-prompt", response_model=CoachPromptResponse)
async def coach_prompt(req: CoachPromptRequest):
    if not req.question.strip():
        raise HTTPException(status_code=400, detail="question must not be empty")
    if _coach_direct_chain is None or _coach_vectorstore is None:
        raise HTTPException(status_code=503, detail="prompt coach not initialized")

    formatted = _format_coach_input(req)
    router_result = router.route(_coach_vectorstore, formatted, k=5)

    if router_result.route == "internal" or _external_provider is None:
        context = format_docs(router_result.docs)
        answer = _coach_direct_chain.invoke({"context": context, "question": formatted})
        model_name = _resolve_internal_model_name(_settings)
        source = _source_from_docs(router_result.docs)
        effective_route = "internal"
    else:
        answer = _external_provider.generate(formatted)
        model_name = _external_provider.model_name
        source = []
        effective_route = "external"

    _route_logger.log(
        route=effective_route,
        model=model_name,
        source=source,
        score=router_result.max_score,
    )

    return CoachPromptResponse(
        advice=answer,
        route=effective_route,
        model=model_name,
        source=source,
        max_score=round(router_result.max_score, 4),
    )


@app.post("/tokenscope/provider-qa", response_model=ProviderQaResponse)
async def provider_qa(req: ProviderQaRequest):
    question = req.question.strip()
    if not question:
        raise HTTPException(status_code=400, detail="question must not be empty")
    if _provider_qa_chain is None:
        raise HTTPException(status_code=503, detail="provider qa not initialized")

    provider = (req.provider or "all").strip().lower()
    sessions = _collect_provider_qa_sessions(provider)
    if not sessions:
        raise HTTPException(status_code=404, detail=f"no sessions found for provider: {provider}")

    scope_summary, context, sources = _build_provider_qa_context(sessions)
    answer = _provider_qa_chain.invoke(
        {
            "provider": _provider_scope_label(provider),
            "scope_summary": scope_summary,
            "context": context,
            "question": question,
        }
    )

    log_provider_qa(
        provider=provider,
        question=question,
        answer=answer,
        sessions_used=len(sources),
        sources=sources,
        scope_summary=scope_summary,
    )

    return ProviderQaResponse(
        answer=answer,
        provider=provider,
        sessions_used=len(sources),
        sources=sources,
        scope_summary=scope_summary,
    )


@app.get("/tokenscope/provider-qa/history", response_model=list[ProviderQaHistoryItem])
async def provider_qa_history(provider: str = "all", limit: int = 20):
    items = read_provider_qa_history(provider=provider, limit=max(1, min(limit, 100)))
    return [
        ProviderQaHistoryItem(
            timestamp=item.get("timestamp", ""),
            provider=item.get("provider", "all"),
            question=item.get("question", ""),
            answer=item.get("answer", ""),
            sessions_used=int(item.get("sessions_used") or 0),
            sources=list(item.get("sources") or []),
            scope_summary=item.get("scope_summary", ""),
        )
        for item in items
    ]


@app.get("/stats/routes")
async def route_stats():
    """Return routing statistics for the current process lifetime."""
    return _route_logger.stats()


# ---------------------------------------------------------------------------
# Private helpers
# ---------------------------------------------------------------------------

def _format_coach_input(req: CoachPromptRequest) -> str:
    parts = [
        f"현재 질문:\n{req.question.strip()}",
    ]
    if req.session_summary:
        parts.append(f"세션 요약:\n{req.session_summary.strip()}")
    if req.project:
        parts.append(f"프로젝트:\n{req.project}")
    if req.provider:
        parts.append(f"AI 도구:\n{req.provider}")
    if req.patterns:
        parts.append("TokenScope 감지 패턴:\n" + "\n".join(f"- {p}" for p in req.patterns))
    if req.score_breakdown:
        scores = "\n".join(
            f"- {key}: {value}" for key, value in req.score_breakdown.items()
        )
        parts.append(f"진단 점수:\n{scores}")
    if req.ambiguity_reason:
        parts.append(f"TokenScope가 판단한 모호한 이유:\n{req.ambiguity_reason.strip()}")
    if req.expected_improvement:
        parts.append(f"TokenScope가 예상한 개선점:\n{req.expected_improvement.strip()}")
    if req.estimated_saved_tokens is not None:
        parts.append(f"TokenScope 예상 절약 토큰:\n약 {req.estimated_saved_tokens:,} 토큰")
    if req.candidate_score is not None:
        parts.append(f"질문 비효율 신호 점수:\n{req.candidate_score}")
    if req.recent_user_messages:
        messages = "\n".join(
            f"- {message.strip()}" for message in req.recent_user_messages if message.strip()
        )
        if messages:
            parts.append(f"최근 사용자 질문:\n{messages}")

    return "\n\n---\n\n".join(parts)


def _collect_provider_qa_sessions(provider: str) -> list[SessionFileResponse]:
    sessions = _list_local_sessions()
    filtered = [session for session in sessions if provider == "all" or _session_provider(session) == provider]
    filtered.sort(key=lambda session: session.modified, reverse=True)
    return filtered[:8]


def _build_provider_qa_context(sessions: list[SessionFileResponse]) -> tuple[str, str, list[str]]:
    scope_counts: dict[str, int] = {}
    sections: list[str] = []
    used_sources: list[str] = []

    for index, session in enumerate(sessions, start=1):
        try:
            content = _read_provider_session_content(Path(session.path))
        except (OSError, HTTPException, sqlite3.Error):
            continue

        messages = _extract_provider_messages(content)
        if not messages:
            continue

        visible = messages[-6:]
        rendered: list[str] = []
        for role, text in visible:
            if not text.strip():
                continue
            truncated = _truncate_text(text.strip(), 240)
            rendered.append(f"- {role}: {truncated}")
            for signal in _extract_scope_signals(text):
                scope_counts[signal] = scope_counts.get(signal, 0) + 1

        if not rendered:
            continue

        used_sources.append(_session_source_label(Path(session.path)))
        sections.append(
            "\n".join(
                [
                    f"[세션 {index}] { _session_source_label(Path(session.path)) }",
                    f"프로젝트: {session.project} / 수정 시각: {datetime.fromtimestamp(session.modified, tz=timezone.utc).isoformat()}",
                    *rendered,
                ]
            )
        )

    if scope_counts:
        ordered = sorted(scope_counts.items(), key=lambda item: (-item[1], item[0]))[:6]
        scope_summary = "반복 신호: " + ", ".join(f"{name}({count})" for name, count in ordered)
    else:
        scope_summary = "명확한 스코프 신호는 적고, 일반 질의나 짧은 교정성 질문이 주로 보입니다."

    context = "\n\n---\n\n".join(sections) if sections else "선택한 provider에서 유효한 세션 메시지를 찾지 못했습니다."
    return scope_summary, context, used_sources


def _read_provider_session_content(path: Path) -> str:
    if _is_cursor_chat_store(path):
        return _read_cursor_store_as_jsonl(path)
    if _is_cursor_state_db(path):
        return _read_cursor_state_as_jsonl(path)
    return path.read_text(encoding="utf-8")


def _extract_provider_messages(raw: str) -> list[tuple[str, str]]:
    raw = raw.strip()
    if not raw:
        return []

    if raw.startswith("{") and raw.endswith("}") and "\n{" not in raw:
        try:
            value = json.loads(raw)
        except json.JSONDecodeError:
            value = None
        if isinstance(value, dict) and isinstance(value.get("messages"), list):
            messages: list[tuple[str, str]] = []
            for item in value["messages"]:
                _extract_provider_message_from_entry(item, messages)
            if messages:
                return messages

    messages: list[tuple[str, str]] = []
    for line in raw.splitlines():
        if not line.strip():
            continue
        try:
            entry = json.loads(line)
        except json.JSONDecodeError:
            continue
        _extract_provider_message_from_entry(entry, messages)
    return messages


def _extract_provider_message_from_entry(entry, messages: list[tuple[str, str]]) -> None:
    if not isinstance(entry, dict):
        return

    entry_type = entry.get("type")
    if entry_type in {"session_meta", "cursor_meta", "wiki_meta", "file-history-snapshot", "info", "event_msg", "turn_context"}:
        return

    if entry_type == "response_item" and isinstance(entry.get("payload"), dict):
        payload = entry["payload"]
        if payload.get("type") != "message":
            return
        role = payload.get("role")
        if role not in {"user", "assistant"}:
            return
        text = _join_content_items(payload.get("content"))
        _append_visible_message(messages, role, text)
        return

    if entry_type == "cursor_message" and isinstance(entry.get("payload"), dict):
        payload = entry["payload"]
        role = payload.get("role")
        if role not in {"user", "assistant"}:
            return
        text = payload.get("content")
        if isinstance(text, list):
            text = "\n".join(
                str(block.get("text") or block.get("content") or block.get("result") or block.get("args") or "")
                for block in text
                if isinstance(block, dict)
            )
        _append_visible_message(messages, role, str(text or ""))
        return

    if isinstance(entry.get("message"), dict):
        message = entry["message"]
        role = message.get("role") or entry.get("role")
        if role not in {"user", "assistant"}:
            return
        text = _join_content_items(message.get("content"))
        _append_visible_message(messages, role, text)
        return

    role = entry.get("role")
    if entry_type in {"user", "assistant"} or role in {"user", "assistant"}:
        normalized_role = "assistant" if entry_type == "assistant" or role == "assistant" else "user"
        text = entry.get("content")
        if isinstance(text, list):
            text = _join_content_items(text)
        _append_visible_message(messages, normalized_role, str(text or ""))


def _append_visible_message(messages: list[tuple[str, str]], role: str, text: str) -> None:
    normalized = _normalize_visible_text(text)
    if normalized:
        messages.append((role, normalized))


def _normalize_visible_text(text: str) -> str:
    value = str(text or "").strip()
    if not value:
        return ""
    hidden_prefixes = (
        "<user_info>",
        "<git_status>",
        "<agent_transcripts>",
        "<rules>",
        "<agent_skills>",
        "<user_shell_command>",
        "<environment_context>",
        "<permissions instructions>",
        "<skills_instructions>",
        "Continue working toward the active thread goal.",
    )
    if value.startswith(hidden_prefixes):
        return ""
    return value


def _join_content_items(content) -> str:
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return ""
    parts: list[str] = []
    for item in content:
        if not isinstance(item, dict):
            continue
        text = item.get("text") or item.get("content") or item.get("result") or ""
        if text:
            parts.append(str(text))
    return "\n".join(parts)


def _extract_scope_signals(text: str) -> list[str]:
    normalized = text.lower()
    signals = []
    rules = [
        ("범위", ("scope", "범위", "하지 마", "수정하지 마", "do not", "don't", "exclud")),
        ("파일", ("file", "files", "파일", "경로", "path")),
        ("테스트", ("test", "tests", "테스트", "검증", "verify")),
        ("에러", ("error", "failed", "failure", "오류", "실패")),
        ("API", ("api", "endpoint", "route", "서버", "backend")),
        ("기능", ("feature", "기능", "동작", "behavior")),
    ]
    for label, needles in rules:
        if any(needle in normalized for needle in needles):
            signals.append(label)
    return signals


def _truncate_text(text: str, max_length: int) -> str:
    value = text.strip()
    if len(value) <= max_length:
        return value
    return value[: max_length - 1].rstrip() + "…"


def _session_provider(session: SessionFileResponse) -> str:
    path = session.path
    if "/tokenscope_rag/sessions/" in path:
        return "wiki"
    if "/.cursor/chats/" in path or "/.cursor/projects/" in path or "/Library/Application Support/Cursor/" in path:
        return "cursor"
    if "/.codex/" in path:
        return "codex"
    if "/.gemini/" in path or "/.omc/" in path:
        return "gemini"
    return "claude"


def _provider_scope_label(provider: str) -> str:
    if provider == "all":
        return "전체 provider"
    if provider == "wiki":
        return "WIKI"
    return provider.capitalize()


def _session_source_label(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        try:
            return str(path.relative_to(Path.home()))
        except ValueError:
            return str(path)


def _list_local_sessions() -> list[SessionFileResponse]:
    home = Path.home()
    sessions: list[SessionFileResponse] = []

    _scan_json_sessions(home / ".claude" / "projects", "claude", sessions, recursive=True)
    _scan_gemini_tmp(home / ".gemini" / "tmp", sessions)
    _scan_json_sessions(home / ".omc" / "state" / "sessions", "omc-global", sessions, recursive=True)
    _scan_json_sessions(home / ".codex" / "sessions", "codex", sessions, recursive=True)
    _scan_cursor_chat_stores(home / ".cursor" / "chats", sessions)
    _scan_cursor_workspace_stores(
        home / "Library" / "Application Support" / "Cursor" / "User" / "workspaceStorage",
        sessions,
    )
    _scan_cursor_agent_transcripts(home / ".cursor" / "projects", sessions)
    _scan_json_sessions(ROOT / "tokenscope_rag" / "sessions", "WIKI", sessions, recursive=True)

    return sessions


def _scan_gemini_tmp(path: Path, sessions: list[SessionFileResponse]) -> None:
    if not path.exists():
        return
    for child in _safe_iterdir(path):
        if child.is_dir():
            _scan_json_sessions(child, child.name, sessions, recursive=True)


def _scan_json_sessions(
    path: Path,
    project_name: str,
    sessions: list[SessionFileResponse],
    *,
    recursive: bool,
) -> None:
    if not path.exists():
        return
    for child in _safe_iterdir(path):
        if child.is_dir() and recursive:
            _scan_json_sessions(child, project_name, sessions, recursive=True)
            continue
        if not child.is_file() or child.suffix not in {".jsonl", ".json"}:
            continue
        if child.name in IGNORED_SESSION_FILES:
            continue
        if project_name == "codex" and not _codex_has_visible_user_turn(child):
            continue

        session = _session_from_file(child, project_name)
        if session:
            sessions.append(session)


def _session_from_file(path: Path, project_name: str) -> SessionFileResponse | None:
    try:
        stats = path.stat()
    except OSError:
        return None
    if stats.st_size < 50:
        return None

    session_id = path.stem
    if "dogfood-bad" in session_id:
        project = "dogfood-bad"
    elif "dogfood-good" in session_id:
        project = "dogfood-good"
    elif "dogfood" in session_id:
        project = "tokenscope-dogfood"
    elif project_name == "codex":
        project = _infer_codex_project(path) or project_name
    else:
        project = project_name

    return SessionFileResponse(
        session_id=session_id,
        project=project,
        path=str(path),
        size_bytes=stats.st_size,
        modified=int(stats.st_mtime),
    )


def _scan_cursor_chat_stores(path: Path, sessions: list[SessionFileResponse]) -> None:
    if not path.exists():
        return
    for child in _safe_iterdir(path):
        if child.is_dir():
            _scan_cursor_chat_stores(child, sessions)
        elif child.name == "store.db" and _cursor_store_has_readable_blobs(child):
            session = _cursor_store_session(child)
            if session:
                sessions.append(session)


def _cursor_store_session(path: Path) -> SessionFileResponse | None:
    try:
        stats = path.stat()
    except OSError:
        return None
    if stats.st_size < 50:
        return None

    agent_id = path.parent.name if path.parent else "cursor"
    workspace_id = path.parent.parent.name if path.parent and path.parent.parent else "cursor"
    return SessionFileResponse(
        session_id=agent_id,
        project=_cursor_project_name(workspace_id),
        path=str(path),
        size_bytes=stats.st_size,
        modified=int(stats.st_mtime),
    )


def _scan_cursor_workspace_stores(path: Path, sessions: list[SessionFileResponse]) -> None:
    if not path.exists():
        return
    for child in _safe_iterdir(path):
        state_db = child / "state.vscdb"
        if child.is_dir() and state_db.exists() and _cursor_state_has_messages(state_db):
            try:
                stats = state_db.stat()
            except OSError:
                continue
            sessions.append(
                SessionFileResponse(
                    session_id=child.name,
                    project=_cursor_workspace_project_name(state_db) or "cursor",
                    path=str(state_db),
                    size_bytes=stats.st_size,
                    modified=int(stats.st_mtime),
                )
            )


def _scan_cursor_agent_transcripts(path: Path, sessions: list[SessionFileResponse]) -> None:
    if not path.exists():
        return
    for project_dir in _safe_iterdir(path):
        transcript_root = project_dir / "agent-transcripts"
        if not project_dir.is_dir() or not transcript_root.exists():
            continue
        for transcript_dir in _safe_iterdir(transcript_root):
            transcript_file = transcript_dir / f"{transcript_dir.name}.jsonl"
            if transcript_dir.is_dir() and transcript_file.exists():
                session = _session_from_file(
                    transcript_file,
                    _cursor_agent_project_name(project_dir.name),
                )
                if session:
                    sessions.append(session)


def _safe_iterdir(path: Path):
    try:
        return list(path.iterdir())
    except OSError:
        return []


def _is_allowed_session_path(path: Path) -> bool:
    if not path.exists() or not path.is_file():
        return False

    home = Path.home().resolve()
    allowed_roots = [
        home / ".claude" / "projects",
        home / ".gemini" / "tmp",
        home / ".omc" / "state" / "sessions",
        home / ".codex" / "sessions",
        home / ".cursor" / "chats",
        home / ".cursor" / "projects",
        home / "Library" / "Application Support" / "Cursor" / "User" / "workspaceStorage",
        ROOT / "tokenscope_rag" / "sessions",
    ]
    resolved_roots = [root.resolve() for root in allowed_roots if root.exists()]
    return any(root == path or root in path.parents for root in resolved_roots)


def _is_cursor_chat_store(path: Path) -> bool:
    return path.name == "store.db" and "/.cursor/chats/" in str(path)


def _is_cursor_state_db(path: Path) -> bool:
    return path.name == "state.vscdb" and "/Library/Application Support/Cursor/User/workspaceStorage/" in str(path)


def _read_cursor_store_as_jsonl(path: Path) -> str:
    lines = []
    meta = _read_cursor_meta(path)
    if meta is not None:
        lines.append(json.dumps({"type": "cursor_meta", "payload": meta}, ensure_ascii=False))

    with _sqlite_connect(path) as conn:
        for row_id, data in conn.execute("select id, data from blobs"):
            text = _blob_to_text(data)
            if not text:
                continue
            try:
                payload = json.loads(text)
            except json.JSONDecodeError:
                continue
            if not payload.get("role"):
                continue
            lines.append(
                json.dumps(
                    {"type": "cursor_message", "id": row_id, "payload": payload},
                    ensure_ascii=False,
                )
            )

    if len(lines) <= 1:
        raise HTTPException(status_code=422, detail="Cursor store did not contain readable message blobs")
    return "\n".join(lines)


def _read_cursor_state_as_jsonl(path: Path) -> str:
    lines = [
        json.dumps(
            {
                "type": "cursor_meta",
                "payload": {
                    "model": "cursor",
                    "workspace": _cursor_workspace_project_name(path) or "cursor",
                },
            },
            ensure_ascii=False,
        )
    ]

    prompts = _read_cursor_state_json_value(path, "aiService.prompts")
    if isinstance(prompts, list):
        for idx, item in enumerate(prompts):
            text = str(item.get("text", "")).strip() if isinstance(item, dict) else ""
            if text:
                lines.append(_cursor_message_line(f"prompt-{idx}", "user", text))

    generations = _read_cursor_state_json_value(path, "aiService.generations")
    if isinstance(generations, list):
        for idx, item in enumerate(generations):
            if not isinstance(item, dict):
                continue
            text = str(item.get("textDescription", "")).strip()
            if text:
                lines.append(
                    _cursor_message_line(
                        str(item.get("generationUUID") or f"generation-{idx}"),
                        "user",
                        text,
                        item.get("unixMs"),
                    )
                )

    if len(lines) <= 1:
        raise HTTPException(status_code=422, detail="Cursor workspace state did not contain readable prompt history")
    return "\n".join(lines)


def _cursor_message_line(message_id: str, role: str, content: str, created_at=None) -> str:
    payload = {
        "id": message_id,
        "role": role,
        "content": content,
        "model": "cursor",
    }
    if created_at is not None:
        payload["createdAt"] = created_at
    return json.dumps({"type": "cursor_message", "id": message_id, "payload": payload}, ensure_ascii=False)


def _read_cursor_meta(path: Path):
    try:
        with _sqlite_connect(path) as conn:
            row = conn.execute("select value from meta where key = '0' limit 1").fetchone()
    except sqlite3.Error:
        return None
    if not row:
        return None
    text = _blob_to_text(row[0])
    if not text:
        return None
    if all(char in "0123456789abcdefABCDEF" for char in text):
        try:
            text = bytes.fromhex(text).decode("utf-8")
        except ValueError:
            pass
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return None


def _read_cursor_state_json_value(path: Path, key: str):
    try:
        with _sqlite_connect(path) as conn:
            row = conn.execute("select value from ItemTable where key = ? limit 1", (key,)).fetchone()
    except sqlite3.Error:
        return None
    if not row:
        return None
    text = _blob_to_text(row[0])
    if not text:
        return None
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return None


def _sqlite_connect(path: Path):
    return sqlite3.connect(f"file:{path}?immutable=1", uri=True)


def _blob_to_text(value) -> str:
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="ignore")
    if value is None:
        return ""
    return str(value)


def _cursor_store_has_readable_blobs(path: Path) -> bool:
    try:
        with _sqlite_connect(path) as conn:
            conn.execute("select 1 from blobs limit 1").fetchone()
        return True
    except sqlite3.Error:
        return False


def _cursor_state_has_messages(path: Path) -> bool:
    try:
        with _sqlite_connect(path) as conn:
            row = conn.execute(
                "select count(*) from ItemTable where key in ('aiService.prompts', 'aiService.generations') and length(value) > 2"
            ).fetchone()
        return bool(row and row[0] > 0)
    except sqlite3.Error:
        return False


def _cursor_project_name(workspace_id: str) -> str:
    workspace_json = Path.home() / ".cursor" / "chats" / workspace_id / "workspace.json"
    if not workspace_json.exists():
        return "cursor"
    try:
        value = json.loads(workspace_json.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return "cursor"
    workspace = value.get("workspace")
    folder = (
        value.get("folder")
        or (workspace.get("folder") if isinstance(workspace, dict) else workspace)
        or value.get("uri")
    )
    return _project_name_from_uri(folder) or "cursor"


def _cursor_workspace_project_name(path: Path) -> str | None:
    workspace_json = path.parent / "workspace.json"
    if not workspace_json.exists():
        return None
    try:
        value = json.loads(workspace_json.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    workspace = value.get("workspace")
    folder = (
        value.get("folder")
        or (workspace.get("folder") if isinstance(workspace, dict) else workspace)
        or value.get("uri")
    )
    return _project_name_from_uri(folder)


def _cursor_agent_project_name(project_id: str) -> str:
    if project_id == "empty-window":
        return "cursor-empty-window"
    if project_id.startswith("Users-"):
        return project_id.rsplit("-", 1)[-1] or project_id
    return project_id


def _project_name_from_uri(value) -> str | None:
    if not value:
        return None
    text = str(value)
    if text.startswith("file://"):
        text = text.removeprefix("file://")
    return Path(text).name or None


def _infer_codex_project(path: Path) -> str | None:
    try:
        first = path.read_text(encoding="utf-8").splitlines()[0]
        value = json.loads(first)
    except (OSError, IndexError, json.JSONDecodeError):
        return None
    cwd = value.get("payload", {}).get("cwd")
    return Path(cwd).name if cwd else None


def _codex_has_visible_user_turn(path: Path) -> bool:
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return False
    for line in lines:
        if not line.strip():
            continue
        try:
            value = json.loads(line)
        except json.JSONDecodeError:
            continue
        payload = value.get("payload", {})
        if value.get("type") != "response_item" or payload.get("type") != "message" or payload.get("role") != "user":
            continue
        content = payload.get("content")
        if not isinstance(content, list):
            continue
        for item in content:
            text = str(item.get("text", "")).strip() if isinstance(item, dict) else ""
            if text and not text.startswith((
                "<user_shell_command>",
                "<environment_context>",
                "<permissions instructions>",
                "<skills_instructions>",
                "Continue working toward the active thread goal.",
            )):
                return True
    return False


def settings_model_label() -> str:
    if _settings is None:
        return "wiki-rag"
    if _settings.llm_provider == "ollama":
        return _settings.ollama_llm_model
    if _settings.llm_provider == "huggingface":
        return _settings.hf_llm_model
    if _settings.llm_provider == "openai":
        return _settings.openai_llm_model
    if _settings.llm_provider == "cursor":
        return _settings.cursor_model
    return "wiki-rag"


def settings_provider_label() -> str:
    return _settings.llm_provider if _settings is not None else "unknown"


def settings_wiki_dir() -> str:
    return _settings.wiki_dir if _settings is not None else ""
