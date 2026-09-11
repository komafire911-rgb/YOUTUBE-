"""台本（ナレーション文章）の自動生成。

Anthropic Claude API を使ってテーマから読み上げ用の台本テキストを生成する。
API キーが無い場合（DRY_RUN やローカル動作確認時）はテンプレートで簡易的な台本を作る。
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from .settings import Settings

logger = logging.getLogger(__name__)


@dataclass
class GeneratedScript:
    title: str
    body: str  # ナレーション本文（TTSにそのまま渡すプレーンテキスト）


def _fallback_script(title: str, prompt: str) -> GeneratedScript:
    """APIキー未設定時のフォールバック（動作確認・DRY_RUN用）。"""
    body = (
        f"今日は「{title}」について話します。{prompt}\n"
        "このテーマについて、要点を順番に見ていきましょう。\n"
        "以上、今回のポイントをまとめると、これからも変化が続いていくということです。\n"
        "最後まで見ていただき、ありがとうございました。"
    )
    return GeneratedScript(title=title, body=body)


def generate_script(title: str, prompt: str, settings: Settings) -> GeneratedScript:
    """テーマ（title, prompt）から台本を生成する。"""
    if not settings.anthropic_api_key:
        logger.warning("ANTHROPIC_API_KEY が未設定のため、簡易テンプレートで台本を生成します。")
        return _fallback_script(title, prompt)

    import anthropic

    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
    cfg = settings.script_cfg

    user_message = (
        f"テーマ: {title}\n"
        f"内容の指示: {prompt}\n"
        f"目安の長さ: 約{cfg.get('target_duration_seconds', 60)}秒でナレーターが読み上げる分量。"
    )

    response = client.messages.create(
        model=cfg.get("model", "claude-sonnet-5"),
        max_tokens=2048,
        system=cfg.get("system_prompt", ""),
        messages=[{"role": "user", "content": user_message}],
    )

    body_parts = [block.text for block in response.content if getattr(block, "type", None) == "text"]
    body = "\n".join(body_parts).strip()

    if not body:
        logger.warning("Claude からの応答が空だったため、フォールバック台本を使用します。")
        return _fallback_script(title, prompt)

    return GeneratedScript(title=title, body=body)
