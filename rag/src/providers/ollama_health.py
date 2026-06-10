import json
import urllib.error
import urllib.request

from src.config import Settings


def _fetch_ollama_models(base_url: str) -> set[str]:
    url = f"{base_url.rstrip('/')}/api/tags"
    try:
        with urllib.request.urlopen(url, timeout=10) as response:
            payload = json.load(response)
    except urllib.error.URLError as exc:
        raise RuntimeError(
            f"Cannot reach Ollama at {base_url}. Is the Ollama app/service running?"
        ) from exc

    names: set[str] = set()
    for model in payload.get("models", []):
        name = model.get("name", "")
        if not name:
            continue
        names.add(name)
        names.add(name.split(":", 1)[0])
    return names


def _model_is_available(model: str, available: set[str]) -> bool:
    if model in available:
        return True
    base = model.split(":", 1)[0]
    return base in available


def validate_ollama_models(settings: Settings) -> None:
    needs_check = (
        settings.llm_provider == "ollama" or settings.embed_provider == "ollama"
    )
    if not needs_check:
        return

    available = _fetch_ollama_models(settings.ollama_base_url)
    missing: list[str] = []

    if settings.llm_provider == "ollama" and not _model_is_available(
        settings.ollama_llm_model, available
    ):
        missing.append(f"LLM model '{settings.ollama_llm_model}'")

    if settings.embed_provider == "ollama" and not _model_is_available(
        settings.ollama_embed_model, available
    ):
        missing.append(f"embedding model '{settings.ollama_embed_model}'")

    if not missing:
        return

    lines = [
        "Required Ollama model(s) are not installed:",
        *[f"  - {item}" for item in missing],
        "",
        "Pull the missing model(s), then rerun:",
    ]
    if settings.embed_provider == "ollama" and not _model_is_available(
        settings.ollama_embed_model, available
    ):
        lines.append(f"  ollama pull {settings.ollama_embed_model}")
    if settings.llm_provider == "ollama" and not _model_is_available(
        settings.ollama_llm_model, available
    ):
        lines.append(f"  ollama pull {settings.ollama_llm_model}")
    lines.append("")
    lines.append(f"Installed models: {', '.join(sorted(available)) or '(none)'}")
    raise RuntimeError("\n".join(lines))
