"""ElevenLabs（高品質・有料）TTSプロバイダ。ELEVENLABS_API_KEY が必要。"""

from __future__ import annotations

from pathlib import Path


def synthesize(
    text: str,
    output_path: Path,
    api_key: str,
    voice_id: str,
    model: str = "eleven_multilingual_v2",
) -> Path:
    from elevenlabs import save
    from elevenlabs.client import ElevenLabs

    client = ElevenLabs(api_key=api_key)
    audio = client.text_to_speech.convert(
        voice_id=voice_id,
        model_id=model,
        text=text,
    )
    save(audio, str(output_path))
    return output_path
