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


_PARTICLES = "をはがにで"


def _split_long(clause: str, max_chars: int) -> list[str]:
    """読点の無い長い節を、助詞の直後（なければ中央）で2つに分ける。"""
    if len(clause) <= max_chars:
        return [clause]
    mid = len(clause) // 2
    # 中央に近い助詞の直後を探す（単語の途中で切らないため）
    candidates = [i + 1 for i, ch in enumerate(clause[:-2]) if ch in _PARTICLES and i >= 3]
    cut = min(candidates, key=lambda i: abs(i - mid)) if candidates else mid
    return _split_long(clause[:cut], max_chars) + _split_long(clause[cut:], max_chars)


def _chunk_sentence(sentence: str, max_chars: int) -> list[str]:
    """1文を、読点（、）の位置で意味のまとまりごとに字幕チャンクへ分ける。"""
    if len(sentence) <= max_chars:
        return [sentence]
    clauses = [c for c in re.split(r"(?<=、)", sentence) if c]
    chunks: list[str] = []
    current = ""
    for clause in clauses:
        if current and len(current) + len(clause) > max_chars:
            chunks.append(current)
            current = ""
        current += clause
    if current:
        chunks.append(current)
    result: list[str] = []
    for chunk in chunks:
        result.extend(_split_long(chunk, max_chars))
    return result


def build_captions(text: str, total_duration: float, max_chars: int = 15) -> list[Caption]:
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
