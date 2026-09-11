"""gTTS（Google翻訳ベースの無料TTS）プロバイダ。APIキー不要。"""

from __future__ import annotations

from pathlib import Path


def synthesize(text: str, output_path: Path, language: str = "ja") -> Path:
    from gtts import gTTS

    tts = gTTS(text=text, lang=language)
    tts.save(str(output_path))
    return output_path
