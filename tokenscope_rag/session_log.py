"""Session logging for TokenScope-owned Wiki RAG questions."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
SESSION_DIR = ROOT / "tokenscope_rag" / "sessions"


def estimate_tokens(text: str) -> int:
    return max(1, len(text) // 4)


def log_wiki_exchange(
    *,
    question: str,
    answer: str,
    model: str,
    provider: str,
    wiki_dir: str,
    started_at: str | None = None,
) -> Path:
    now = datetime.now(timezone.utc)
    started = started_at or now.isoformat()
    finished = now.isoformat()
    path = SESSION_DIR / f"wiki-{now.date().isoformat()}.jsonl"
    SESSION_DIR.mkdir(parents=True, exist_ok=True)

    entries: list[dict[str, Any]] = [
        {
            "type": "wiki_meta",
            "timestamp": started,
            "payload": {
                "model": model,
                "provider": provider,
                "wikiDir": wiki_dir,
            },
        },
        {
            "type": "user",
            "timestamp": started,
            "content": question,
            "model": model,
            "tokens": {
                "input_tokens": estimate_tokens(question),
            },
        },
        {
            "type": "assistant",
            "timestamp": finished,
            "content": answer,
            "model": model,
            "tokens": {
                "output_tokens": estimate_tokens(answer),
            },
        },
    ]

    with path.open("a", encoding="utf-8") as file:
        for entry in entries:
            file.write(json.dumps(entry, ensure_ascii=False) + "\n")

    return path
