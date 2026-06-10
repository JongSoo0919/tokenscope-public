import os
from dataclasses import dataclass

from dotenv import load_dotenv


@dataclass(frozen=True)
class Settings:
    wiki_dir: str
    prompt_coach_wiki_dir: str
    persist_dir: str
    prompt_coach_persist_dir: str

    llm_provider: str
    embed_provider: str

    ollama_base_url: str
    ollama_llm_model: str
    ollama_embed_model: str

    hf_token: str | None
    hf_llm_model: str
    hf_embed_model: str

    openai_api_key: str | None
    openai_llm_model: str

    cursor_api_key: str | None
    cursor_model: str

    response_language: str


def load_settings() -> Settings:
    load_dotenv()
    load_dotenv(".env.local", override=True)

    return Settings(
        wiki_dir=os.getenv("WIKI_DIR", "./wiki"),
        prompt_coach_wiki_dir=os.getenv("PROMPT_COACH_WIKI_DIR", "./prompt-coach-wiki"),
        persist_dir=os.getenv("PERSIST_DIR", ".chroma"),
        prompt_coach_persist_dir=os.getenv(
            "PROMPT_COACH_PERSIST_DIR", ".chroma-prompt-coach"
        ),
        llm_provider=os.getenv("LLM_PROVIDER", "ollama").lower(),
        embed_provider=os.getenv("EMBED_PROVIDER", "ollama").lower(),
        ollama_base_url=os.getenv("OLLAMA_BASE_URL", "http://localhost:11434"),
        ollama_llm_model=os.getenv("OLLAMA_LLM_MODEL")
        or os.getenv("LLM_MODEL", "llama3"),
        ollama_embed_model=os.getenv("OLLAMA_EMBED_MODEL")
        or os.getenv("EMBED_MODEL", "nomic-embed-text"),
        hf_token=os.getenv("HUGGINGFACEHUB_API_TOKEN"),
        hf_llm_model=os.getenv("HF_LLM_MODEL", "meta-llama/Meta-Llama-3-8B-Instruct"),
        hf_embed_model=os.getenv(
            "HF_EMBED_MODEL", "sentence-transformers/all-MiniLM-L6-v2"
        ),
        openai_api_key=os.getenv("OPENAI_API_KEY"),
        openai_llm_model=os.getenv("OPENAI_LLM_MODEL", "gpt-4o-mini"),
        cursor_api_key=os.getenv("CURSOR_API_KEY"),
        cursor_model=os.getenv("CURSOR_MODEL", "composer-2.5"),
        response_language=os.getenv("RESPONSE_LANGUAGE", "ko").lower(),
    )
