from langchain.chat_models import init_chat_model
from langchain_core.language_models.chat_models import BaseChatModel

from src.config import Settings
from src.providers.cursor_adapter import CursorChatModel

SUPPORTED_LLM_PROVIDERS = ("ollama", "huggingface", "openai", "cursor")


def create_llm(settings: Settings) -> BaseChatModel:
    provider = settings.llm_provider

    if provider == "ollama":
        return init_chat_model(
            settings.ollama_llm_model,
            model_provider="ollama",
            base_url=settings.ollama_base_url,
            temperature=0.7,
        )

    if provider == "huggingface":
        if not settings.hf_token:
            raise ValueError(
                "HUGGINGFACEHUB_API_TOKEN is required when LLM_PROVIDER=huggingface"
            )
        return init_chat_model(
            settings.hf_llm_model,
            model_provider="huggingface",
            huggingfacehub_api_token=settings.hf_token,
            temperature=0.7,
        )

    if provider == "openai":
        if not settings.openai_api_key:
            raise ValueError("OPENAI_API_KEY is required when LLM_PROVIDER=openai")
        return init_chat_model(
            settings.openai_llm_model,
            model_provider="openai",
            api_key=settings.openai_api_key,
            temperature=0.7,
        )

    if provider == "cursor":
        if not settings.cursor_api_key:
            raise ValueError("CURSOR_API_KEY is required when LLM_PROVIDER=cursor")
        return CursorChatModel(
            api_key=settings.cursor_api_key,
            model=settings.cursor_model,
        )

    raise ValueError(
        f"Unknown LLM provider: {provider}. "
        f"Supported providers: {', '.join(SUPPORTED_LLM_PROVIDERS)}"
    )
