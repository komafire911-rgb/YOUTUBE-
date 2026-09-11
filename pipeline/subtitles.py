"""ナレーション本文を字幕チャンクに分割するユーティリティ。"""

from __future__ import annotations

import re
from dataclasses import dataclass


@dataclass
class Caption:
    text: str
    start: float  # 秒
    end: float  # 秒


def _split_into_sentences(text: str) -> list[str]:
    # 句点・改行で区切り、空要素は除く
    parts = re.split(r"(?<=[。！？\n])", text)
    return [p.strip() for p in parts if p.strip()]


def _chunk_sentence(sentence: str, max_chars: int) -> list[str]:
    if len(sentence) <= max_chars:
        return [sentence]
    chunks = []
    current = ""
    for ch in sentence:
        current += ch
        if len(current) >= max_chars:
            chunks.append(current)
            current = ""
    if current:
        chunks.append(current)
    return chunks


def build_captions(text: str, total_duration: float, max_chars: int = 30) -> list[Caption]:
    """本文を字幕チャンクに分割し、動画全体の長さに応じて等分の表示時間を割り当てる。

    正確な音声同期（単語単位のタイムスタンプ）は行わず、文字数の比率で
    均等に時間配分する簡易実装。より精度が必要な場合は TTS 側の
    タイムスタンプ機能（対応プロバイダのみ）に置き換えること。
    """
    sentences = _split_into_sentences(text)
    chunks: list[str] = []
    for s in sentences:
        chunks.extend(_chunk_sentence(s, max_chars))

    if not chunks:
        return []

    total_chars = sum(len(c) for c in chunks) or 1
    captions: list[Caption] = []
    cursor = 0.0
    for chunk in chunks:
        share = len(chunk) / total_chars
        duration = total_duration * share
        captions.append(Caption(text=chunk, start=cursor, end=cursor + duration))
        cursor += duration

    # 最後のcaptionの終了時刻を動画長に一致させる（誤差調整）
    if captions:
        captions[-1] = Caption(text=captions[-1].text, start=captions[-1].start, end=total_duration)

    return captions
