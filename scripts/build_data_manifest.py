#!/usr/bin/env python3
"""Build runtime JSON shards and a content-hash manifest.

The source JSON files stay in place for the existing data scripts. The frontend
uses the smaller generated files plus data/manifest.json for stable caching.
"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
MANIFEST_PATH = DATA_DIR / "manifest.json"
CHINA_TZ = timezone(timedelta(hours=8))


def read_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def write_json(path: Path, obj: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(obj, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )


def year_file_name(year: str) -> str:
    if year == "全部":
        return "all"
    safe = "".join(ch for ch in str(year) if ch.isalnum() or ch in ("-", "_"))
    return safe or "unknown"


def build_history_shards() -> None:
    path = DATA_DIR / "history.json"
    if not path.exists():
        return
    history = read_json(path)
    updated_at = history.get("updated_at", "")

    for key, default in (
        ("disasters", {}),
        ("flights", {}),
        ("fortunes", []),
    ):
        write_json(
            DATA_DIR / "history" / f"{key}.json",
            {"updated_at": updated_at, key: history.get(key, default)},
        )

    for year, pack in (history.get("preference_by_year") or {}).items():
        write_json(
            DATA_DIR / "preference" / f"{year_file_name(str(year))}.json",
            {
                "updated_at": updated_at,
                "year": year,
                "ms": (pack or {}).get("ms", []),
                "ws": (pack or {}).get("ws", []),
            },
        )


def build_preference_shards() -> None:
    path = DATA_DIR / "preference.json"
    if not path.exists():
        return
    preference = read_json(path)
    write_json(
        DATA_DIR / "preference" / "current.json",
        {
            "updated_at": preference.get("updated_at", ""),
            "ms": preference.get("ms", []),
            "ws": preference.get("ws", []),
        },
    )


def build_breakdown_shards() -> None:
    path = DATA_DIR / "breakdown.json"
    if not path.exists():
        return
    breakdown = read_json(path)
    meta = {k: v for k, v in breakdown.items() if k not in ("ms", "ws")}
    write_json(DATA_DIR / "breakdown" / "meta.json", meta)
    for tour in ("ms", "ws"):
        write_json(
            DATA_DIR / "breakdown" / f"{tour}.json",
            {
                "updated_at": breakdown.get("updated_at", ""),
                "tour": tour,
                "rows": breakdown.get(tour, []),
            },
        )


def build_manifest() -> None:
    files = {}
    for path in sorted(DATA_DIR.rglob("*.json")):
        if path == MANIFEST_PATH:
            continue
        rel = path.relative_to(ROOT).as_posix()
        payload = path.read_bytes()
        files[rel] = {
            "version": hashlib.sha256(payload).hexdigest()[:16],
            "bytes": len(payload),
        }
    manifest = {
        "updated_at": datetime.now(CHINA_TZ).strftime("%Y-%m-%d %H:%M:%S"),
        "files": files,
    }
    write_json(MANIFEST_PATH, manifest)


def main() -> None:
    build_history_shards()
    build_preference_shards()
    build_breakdown_shards()
    build_manifest()
    print(f"manifest updated with {len(read_json(MANIFEST_PATH)['files'])} files")


if __name__ == "__main__":
    main()
