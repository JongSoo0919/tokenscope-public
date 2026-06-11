"""Route event logger for the Hybrid AI Router.

Maintains in-memory counters for the current process and appends structured
JSONL records to .run/route_log.jsonl so the Dashboard can read historical
data across restarts.

Log entry schema:
  {
    "ts":     "2026-06-11T07:00:00+00:00",  // ISO-8601 UTC
    "route":  "internal" | "external",
    "model":  "qwen2.5:7b",
    "source": ["prompt-coach-wiki/token-economy.md"],
    "score":  0.87
  }
"""

import json
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

LOG_PATH = Path(__file__).resolve().parent.parent / ".run" / "route_log.jsonl"


class RouteLogger:
    def __init__(self) -> None:
        self._counts: dict[str, int] = defaultdict(int)
        self._sources: dict[str, int] = defaultdict(int)

    def log(self, route: str, model: str, source: list[str], score: float = 0.0) -> None:
        entry = {
            "ts": datetime.now(timezone.utc).isoformat(),
            "route": route,
            "model": model,
            "source": source,
            "score": round(score, 4),
        }
        LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
        with LOG_PATH.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(entry, ensure_ascii=False) + "\n")

        self._counts[route] += 1
        for s in source:
            if s:
                self._sources[s] += 1

    def stats(self) -> dict:
        total = sum(self._counts.values())
        return {
            "total": total,
            "route_counts": dict(self._counts),
            "route_ratio": (
                {k: round(v / total, 3) for k, v in self._counts.items()}
                if total
                else {}
            ),
            "top_sources": [
                {"source": src, "count": cnt}
                for src, cnt in sorted(
                    self._sources.items(), key=lambda x: -x[1]
                )[:10]
            ],
        }
