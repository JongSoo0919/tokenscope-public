from langchain_core.embeddings import Embeddings
from langchain_ollama import OllamaEmbeddings

from src.config import Settings

SUPPORTED_EMBED_PROVIDERS = ("ollama", "huggingface")


def create_embeddings(settings: Settings) -> Embeddings:
    provider = settings.embed_provider

    if provider == "ollama":
        return OllamaEmbeddings(
            model=settings.ollama_embed_model,
            base_url=settings.ollama_base_url,
        )

    if provider == "huggingface":
        try:
            from langchain_huggingface import HuggingFaceEmbeddings
        except ImportError as exc:
            raise ImportError(
                "langchain-huggingface is required when EMBED_PROVIDER=huggingface. "
                "Install it with: pip install langchain-huggingface"
            ) from exc

        model_kwargs = {}
        if settings.hf_token:
            model_kwargs["token"] = settings.hf_token

        return HuggingFaceEmbeddings(
            model_name=settings.hf_embed_model,
            model_kwargs=model_kwargs,
        )

    raise ValueError(
        f"Unknown embedding provider: {provider}. "
        f"Supported providers: {', '.join(SUPPORTED_EMBED_PROVIDERS)}"
    )
