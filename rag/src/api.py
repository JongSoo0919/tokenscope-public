#!/usr/bin/env python3
"""FastAPI server that exposes the RAG chain over HTTP."""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from src.chain import build_prompt_coach_chain, build_rag_chain
from src.config import load_settings
from src.loader import load_and_chunk_wiki
from src.providers import create_embeddings, create_llm
from src.providers.ollama_health import validate_ollama_models
from src.vectorstore import build_or_load_vectorstore, get_retriever

# ──────────────────────────────────────────────
# Helpers (reused from app.py)
# ──────────────────────────────────────────────

def _embed_label(settings) -> str:
    if settings.embed_provider == "ollama":
        return settings.ollama_embed_model
    if settings.embed_provider == "huggingface":
        return settings.hf_embed_model
    return "unknown"


def _embed_meta_path(persist_dir: str) -> Path:
    return Path(persist_dir) / ".embed_model"


def _needs_rebuild(
    settings,
    persist_path: Path,
    rebuild: bool,
    persist_dir: str | None = None,
) -> bool:
    if rebuild:
        return True
    if not persist_path.exists() or not any(persist_path.iterdir()):
        return True
    meta_path = _embed_meta_path(persist_dir or settings.persist_dir)
    if not meta_path.exists():
        return True
    current = f"{settings.embed_provider}:{_embed_label(settings)}"
    stored = meta_path.read_text(encoding="utf-8").strip()
    return stored != current


def _save_embed_meta(settings, persist_dir: str | None = None) -> None:
    meta_path = _embed_meta_path(persist_dir or settings.persist_dir)
    meta_path.write_text(
        f"{settings.embed_provider}:{_embed_label(settings)}",
        encoding="utf-8",
    )


# ──────────────────────────────────────────────
# App-level state
# ──────────────────────────────────────────────

_chain = None
_coach_chain = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize the RAG chain once at startup."""
    global _chain
    global _coach_chain

    print("Initializing RAG system...")
    settings = load_settings()

    validate_ollama_models(settings)
    embeddings = create_embeddings(settings)
    llm = create_llm(settings)

    persist_path = Path(settings.persist_dir)
    if _needs_rebuild(settings, persist_path, rebuild=False):
        print("Loading wiki documents and building vectorstore...")
        docs = load_and_chunk_wiki(settings.wiki_dir)
        vectorstore = build_or_load_vectorstore(
            docs=docs,
            embeddings=embeddings,
            persist_dir=settings.persist_dir,
            rebuild=True,
        )
        _save_embed_meta(settings)
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

    coach_persist_path = Path(settings.prompt_coach_persist_dir)
    if _needs_rebuild(
        settings,
        coach_persist_path,
        rebuild=False,
        persist_dir=settings.prompt_coach_persist_dir,
    ):
        print("Loading prompt coach wiki and building vectorstore...")
        coach_docs = load_and_chunk_wiki(settings.prompt_coach_wiki_dir)
        coach_vectorstore = build_or_load_vectorstore(
            docs=coach_docs,
            embeddings=embeddings,
            persist_dir=settings.prompt_coach_persist_dir,
            rebuild=True,
        )
        _save_embed_meta(settings, settings.prompt_coach_persist_dir)
    else:
        print("Using cached prompt coach vectorstore...")
        coach_vectorstore = build_or_load_vectorstore(
            docs=None,
            embeddings=embeddings,
            persist_dir=settings.prompt_coach_persist_dir,
        )

    coach_retriever = get_retriever(coach_vectorstore, k=5)
    _coach_chain, _ = build_prompt_coach_chain(
        retriever=coach_retriever,
        llm=llm,
    )
    print("RAG system ready.")
    yield


# ──────────────────────────────────────────────
# FastAPI app
# ──────────────────────────────────────────────

app = FastAPI(title="Wiki RAG API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ──────────────────────────────────────────────
# Request / Response schemas
# ──────────────────────────────────────────────

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


# ──────────────────────────────────────────────
# Endpoints
# ──────────────────────────────────────────────

@app.get("/")
async def root():
    return {"message": "Wiki RAG API is running. POST /ask to query."}


@app.post("/ask", response_model=AskResponse)
async def ask(req: AskRequest):
    """Return a complete answer for the given question."""
    if not req.question.strip():
        raise HTTPException(status_code=400, detail="question must not be empty")
    if _chain is None:
        raise HTTPException(status_code=503, detail="RAG chain not initialized")

    answer = _chain.invoke(req.question)
    return AskResponse(answer=answer)


@app.post("/ask/stream")
async def ask_stream(req: AskRequest):
    """Stream the answer token-by-token using Server-Sent Events."""
    if not req.question.strip():
        raise HTTPException(status_code=400, detail="question must not be empty")
    if _chain is None:
        raise HTTPException(status_code=503, detail="RAG chain not initialized")

    def token_generator():
        for token in _chain.stream(req.question):
            # SSE format: data: <payload>\n\n
            yield f"data: {token}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(token_generator(), media_type="text/event-stream")


@app.post("/coach-prompt", response_model=CoachPromptResponse)
async def coach_prompt(req: CoachPromptRequest):
    """Return a prompt-quality diagnosis and a better next question."""
    if not req.question.strip():
        raise HTTPException(status_code=400, detail="question must not be empty")
    if _coach_chain is None:
        raise HTTPException(status_code=503, detail="prompt coach not initialized")

    answer = _coach_chain.invoke(_format_coach_input(req))
    return CoachPromptResponse(advice=answer)


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
