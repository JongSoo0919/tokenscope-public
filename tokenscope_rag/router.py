"""Hybrid AI Router for TokenScope RAG.

Performs a scored retrieval against the vectorstore and decides whether to
route to the local (internal) RAG chain or an external LLM provider.

Routing rules:
  score >= INTERNAL_THRESHOLD  →  internal (wiki is highly relevant)
  score <= EXTERNAL_THRESHOLD  →  external (wiki has no useful context)
  middle band                  →  internal (conservative default; extend to
                                  hybrid later by checking RouterResult.route)

The retrieved docs are returned so the caller can pass them directly to the
chain, avoiding a second retrieval call.
"""

import os
from dataclasses import dataclass, field

from langchain_chroma import Chroma
from langchain_core.documents import Document

INTERNAL_THRESHOLD = float(os.getenv("ROUTER_INTERNAL_THRESHOLD", "0.8"))
EXTERNAL_THRESHOLD = float(os.getenv("ROUTER_EXTERNAL_THRESHOLD", "0.3"))


@dataclass
class RouterResult:
    route: str               # "internal" | "external"
    max_score: float         # highest relevance score among retrieved docs
    docs: list[Document] = field(default_factory=list)


def route(vectorstore: Chroma, question: str, k: int = 5) -> RouterResult:
    """Score the question against the vectorstore and decide a route.

    Uses `similarity_search_with_relevance_scores` which returns cosine
    similarity scores normalised to [0, 1] by LangChain's Chroma wrapper
    (1.0 = perfect match).
    """
    results = vectorstore.similarity_search_with_relevance_scores(question, k=k)
    if not results:
        return RouterResult(route="external", max_score=0.0, docs=[])

    max_score = max(score for _, score in results)
    docs = [doc for doc, _ in results]

    if max_score <= EXTERNAL_THRESHOLD:
        label = "external"
    else:
        label = "internal"

    return RouterResult(route=label, max_score=max_score, docs=docs)
