"""音声合成（TTS）のディスパッチ層。config の provider 設定に応じて実装を切り替える。"""

from __future__ import annotations

import logging
from pathlib import Path

from .settings import Settings

logger = logging.getLogger(__name__)


def synthesize_speech(text: str, output_path: Path, settings: Settings) -> Path:
    """台本テキストを音声ファイル（mp3）に変換する。"""
    cfg = settings.tts_cfg
    provider = cfg.get("provider", "gtts")

    if provider == "elevenlabs":
        if not settings.elevenlabs_api_key or not settings.elevenlabs_voice_id:
            logger.warning(
                "ELEVENLABS_API_KEY / ELEVENLABS_VOICE_ID が未設定のため gTTS にフォールバックします。"
            )
            provider = "gtts"

    if provider == "elevenlabs":
        from .providers import tts_elevenlabs

        return tts_elevenlabs.synthesize(
            text=text,
            output_path=output_path,
            api_key=settings.elevenlabs_api_key,  # type: ignore[arg-type]
            voice_id=settings.elevenlabs_voice_id,  # type: ignore[arg-type]
            model=cfg.get("elevenlabs", {}).get("model", "eleven_multilingual_v2"),
        )

    from .providers import tts_gtts

    return tts_gtts.synthesize(text=text, output_path=output_path, language=cfg.get("language", "ja"))
