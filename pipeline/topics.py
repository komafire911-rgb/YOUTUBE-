"""config/topics.yaml のテーマキューを管理する。"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import yaml

from .settings import TOPICS_PATH


@dataclass
class Topic:
    id: str
    title: str
    prompt: str
    status: str = "pending"


def _load_raw() -> dict[str, Any]:
    with open(TOPICS_PATH, encoding="utf-8") as f:
        return yaml.safe_load(f) or {"topics": []}


def _save_raw(data: dict[str, Any]) -> None:
    with open(TOPICS_PATH, "w", encoding="utf-8") as f:
        yaml.safe_dump(data, f, allow_unicode=True, sort_keys=False)


def next_pending_topic() -> Topic | None:
    """未処理（status: pending）の先頭のテーマを返す。無ければ None。"""
    data = _load_raw()
    for item in data.get("topics", []):
        if item.get("status", "pending") == "pending":
            return Topic(
                id=item["id"],
                title=item["title"],
                prompt=item["prompt"],
                status=item.get("status", "pending"),
            )
    return None


def mark_topic_status(topic_id: str, status: str) -> None:
    """指定したテーマの status を更新する（done / failed 等）。"""
    data = _load_raw()
    for item in data.get("topics", []):
        if item.get("id") == topic_id:
            item["status"] = status
            break
    _save_raw(data)
