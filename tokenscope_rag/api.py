#!/usr/bin/env python3
"""TokenScope-owned RAG API wrapper.

The generic RAG implementation lives in the `rag/` submodule. TokenScope-specific
prompt coaching endpoints and knowledge live in this package so the submodule can
track upstream without carrying product-specific code.
"""

import os
import sys
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

from tokenscope_rag.external_provider import (
    ExternalLLMProvider,
    create_external_provider,
)
from tokenscope_rag.route_logger import RouteLogger
import tokenscope_rag.router as router

PROMPT_COACH_WIKI_DIR = ROOT / "tokenscope_rag" / "prompt-coach-wiki"
PROMPT_COACH_PERSIST_DIR = ROOT / "tokenscope_rag" / ".chroma-prompt-coach"

# ---------------------------------------------------------------------------
# Globals set during lifespan startup
# ---------------------------------------------------------------------------
_chain = None
_coach_chain = None
_coach_direct_chain = None       # accepts pre-fetched context (no retriever)
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


# ---------------------------------------------------------------------------
# Lifespan
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    global _chain, _coach_chain, _coach_direct_chain
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


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.get("/")
async def root():
    return {"message": "TokenScope RAG API is running. POST /ask or /coach-prompt to query."}


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
