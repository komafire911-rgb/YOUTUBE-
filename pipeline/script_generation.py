"""台本（ナレーション文章）の自動生成。

Anthropic Claude API を使ってテーマから「楽々脳活」フォーマット
（TITLE / NARRATION / DESCRIPTION / HASHTAGS）の台本を生成する。
API キーが無い場合（DRY_RUN やローカル動作確認時）はテンプレートで簡易的な台本を作る。
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field

from .settings import Settings

logger = logging.getLogger(__name__)

# LLMの出力を "KEY: 値"（複数行可）の形式でパースするためのキー一覧
_FIELD_ORDER = ["TITLE", "NARRATION", "DESCRIPTION", "HASHTAGS"]


@dataclass
class GeneratedScript:
    title: str
    body: str  # ナレーション本文（TTSにそのまま渡すプレーンテキスト）
    description: str = ""  # YouTube概要欄用テキスト
    hashtags: list[str] = field(default_factory=list)

    @property
    def youtube_description(self) -> str:
        """概要欄に貼り付けるテキスト（説明文 + ハッシュタグ）。"""
        tags_line = " ".join(self.hashtags)
        if self.description and tags_line:
            return f"{self.description}\n\n{tags_line}"
        return self.description or tags_line


def _parse_structured_output(text: str, fallback_title: str) -> GeneratedScript:
    """"TITLE: ...\nNARRATION: ...\n..." 形式のテキストを GeneratedScript にパースする。"""
    # 各キーの開始位置で分割する
    pattern = r"(?:^|\n)\s*(" + "|".join(_FIELD_ORDER) + r")\s*:\s*"
    parts = re.split(pattern, text)
    # re.split の結果は [前置き, キー1, 値1, キー2, 値2, ...] になる
    fields: dict[str, str] = {}
    for i in range(1, len(parts) - 1, 2):
        key = parts[i].strip()
        value = parts[i + 1].strip()
        fields[key] = value

    title = fields.get("TITLE", fallback_title).strip() or fallback_title
    narration = fields.get("NARRATION", "").strip()
    description = fields.get("DESCRIPTION", "").strip()
    hashtags_raw = fields.get("HASHTAGS", "").strip()
    hashtags = [t for t in re.split(r"\s+", hashtags_raw) if t.startswith("#")]

    if not narration:
        # パースに失敗した場合は全文をナレーションとして扱う（フォールバック）
        logger.warning("台本の構造化パースに失敗したため、応答全文をナレーションとして使用します。")
        narration = text.strip()

    return GeneratedScript(title=title, body=narration, description=description, hashtags=hashtags)


def _fallback_script(title: str, prompt: str) -> GeneratedScript:
    """APIキー未設定時のフォールバック（動作確認・DRY_RUN用）。"""
    narration = (
        f"今日は「{title}」についてお話しします。{prompt} "
        "実はこれ、脳の仕組みを知るととても面白いんです。"
        "毎日の生活の中でも、意識してみると新しい発見があるかもしれません。"
    )
    description = f"「{title}」について、楽々脳活が脳科学の視点で解説します。"
    hashtags = ["#脳科学", "#雑学", "#楽々脳活", "#Shorts"]
    return GeneratedScript(title=title, body=narration, description=description, hashtags=hashtags)


def generate_script(title: str, prompt: str, settings: Settings) -> GeneratedScript:
    """テーマ（title, prompt）から「楽々脳活」フォーマットの台本を生成する。"""
    if not settings.anthropic_api_key:
        logger.warning("ANTHROPIC_API_KEY が未設定のため、簡易テンプレートで台本を生成します。")
        return _fallback_script(title, prompt)

    import anthropic

    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
    cfg = settings.script_cfg

    user_message = (
        f"テーマ: {title}\n"
        f"内容の指示: {prompt}\n"
        f"目安の長さ: 約{cfg.get('target_duration_seconds', 45)}秒でナレーターが読み上げる分量。"
    )

    response = client.messages.create(
        model=cfg.get("model", "claude-sonnet-5"),
        max_tokens=2048,
        system=cfg.get("system_prompt", ""),
        messages=[{"role": "user", "content": user_message}],
    )

    body_parts = [block.text for block in response.content if getattr(block, "type", None) == "text"]
    raw_text = "\n".join(body_parts).strip()

    if not raw_text:
        logger.warning("Claude からの応答が空だったため、フォールバック台本を使用します。")
        return _fallback_script(title, prompt)

    return _parse_structured_output(raw_text, fallback_title=title)
