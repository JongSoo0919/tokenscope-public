"""Persistence helpers for provider-scoped QA history."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
HISTORY_DIR = ROOT / "tokenscope_rag" / "provider-qa"


def log_provider_qa(
    *,
    provider: str,
    question: str,
    answer: str,
    sessions_used: int,
    sources: list[str],
    scope_summary: str,
) -> Path:
    now = datetime.now(timezone.utc)
    HISTORY_DIR.mkdir(parents=True, exist_ok=True)
    path = HISTORY_DIR / f"history-{now.date().isoformat()}.jsonl"

    entry: dict[str, Any] = {
        "type": "provider_qa",
        "timestamp": now.isoformat(),
        "provider": provider,
        "question": question,
        "answer": answer,
        "sessions_used": sessions_used,
        "sources": sources,
        "scope_summary": scope_summary,
    }

    with path.open("a", encoding="utf-8") as file:
        file.write(json.dumps(entry, ensure_ascii=False) + "\n")

    return path


def read_provider_qa_history(provider: str | None = None, limit: int = 20) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    if not HISTORY_DIR.exists():
        return items

    for path in sorted(HISTORY_DIR.glob("history-*.jsonl"), reverse=True):
        try:
            lines = path.read_text(encoding="utf-8").splitlines()
        except OSError:
            continue
        for line in reversed(lines):
            if not line.strip():
                continue
            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                continue
            if entry.get("type") != "provider_qa":
                continue
            if provider and provider != "all" and entry.get("provider") != provider:
                continue
            items.append(entry)
            if len(items) >= limit:
                return items
    return items
