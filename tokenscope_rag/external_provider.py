"""External LLM provider abstraction for the Hybrid AI Router.

Wraps `create_llm()` from the rag submodule so the router can call an
external model (OpenAI, Cursor, HuggingFace) without duplicating provider
logic.  The import of `create_llm` is deferred to runtime because the rag
submodule is added to sys.path by `tokenscope_rag/api.py` at startup.

Configure via environment variables:
  EXTERNAL_LLM_PROVIDER=cursor   # cursor | openai | huggingface (default: cursor)
"""

import os
from abc import ABC, abstractmethod

from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import HumanMessage


class ExternalLLMProvider(ABC):
    @abstractmethod
    def generate(self, question: str) -> str: ...

    @property
    @abstractmethod
    def model_name(self) -> str: ...


class LangChainExternalProvider(ExternalLLMProvider):
    """Wraps any LangChain BaseChatModel as an external provider."""

    def __init__(self, llm: BaseChatModel, name: str):
        self._llm = llm
        self._name = name

    def generate(self, question: str) -> str:
        return self._llm.invoke([HumanMessage(content=question)]).content

    @property
    def model_name(self) -> str:
        return self._name


def _resolve_model_name(settings, provider: str) -> str:
    if provider == "openai":
        return settings.openai_llm_model
    if provider == "cursor":
        return settings.cursor_model
    if provider == "huggingface":
        return settings.hf_llm_model
    if provider == "ollama":
        return settings.ollama_llm_model
    return provider


def create_external_provider(settings) -> ExternalLLMProvider | None:
    """Create an external LLM provider from settings.

    Returns None if the required credentials are missing so the caller can
    gracefully fall back to the internal route.
    """
    import dataclasses

    from src.providers import create_llm

    provider = os.getenv("EXTERNAL_LLM_PROVIDER", "cursor").lower()

    if provider == settings.llm_provider:
        # External and internal are the same provider — skip separate init
        # and return None so the caller falls back to the internal chain.
        return None

    try:
        ext_settings = dataclasses.replace(settings, llm_provider=provider)
        llm = create_llm(ext_settings)
        model_name = _resolve_model_name(ext_settings, provider)
        return LangChainExternalProvider(llm, model_name)
    except (ValueError, ImportError) as exc:
        print(
            f"[HybridRouter] External provider '{provider}' unavailable: {exc}. "
            "External routes will fall back to internal."
        )
        return None
