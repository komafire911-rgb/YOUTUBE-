"""Google Gemini（Imagen）による背景イラストの自動生成。

台本のタイトル・ナレーションから、動画の背景に使うイラストを1枚生成する。
GEMINI_API_KEY が未設定、または生成に失敗した場合は None を返し、
呼び出し側（video_assembly）で単色背景にフォールバックする。
"""

from __future__ import annotations

import logging
from pathlib import Path

from .settings import Settings

logger = logging.getLogger(__name__)


def _build_prompt(title: str, narration: str) -> str:
    return (
        "Create a clean, modern flat-design illustration for a Japanese YouTube Shorts "
        "video about brain science and trivia. "
        f"Topic: {title}. Context: {narration[:200]}. "
        "Style: minimal flat vector illustration, soft gradient background, "
        "simple shapes, no text, no letters, no words, no logos, no watermark. "
        "Vertical composition with calm empty space near the center and bottom "
        "so text can be overlaid later."
    )


def generate_background_image(title: str, narration: str, settings: Settings) -> Path | None:
    """背景イラストを生成して output_dir に保存し、そのパスを返す。失敗時は None。"""
    image_cfg = settings.image_cfg
    if not image_cfg.get("enabled", True):
        return None
    if not settings.gemini_api_key:
        logger.warning("GEMINI_API_KEY が未設定のため、背景イラスト生成をスキップします（単色背景を使用）。")
        return None

    try:
        from google import genai
        from google.genai import types

        client = genai.Client(api_key=settings.gemini_api_key)
        model = image_cfg.get("model", "imagen-4.0-generate-001")
        prompt = _build_prompt(title, narration)

        response = client.models.generate_images(
            model=model,
            prompt=prompt,
            config=types.GenerateImagesConfig(
                number_of_images=1,
                aspect_ratio="9:16",
            ),
        )

        if not response.generated_images:
            logger.warning("Gemini から画像が返されなかったため、単色背景を使用します。")
            return None

        image_path = settings.output_dir / "_bg_photo.png"
        response.generated_images[0].image.save(str(image_path))
        logger.info("背景イラストを生成しました: %s", image_path)
        return image_path

    except Exception:
        logger.exception("背景イラスト生成に失敗したため、単色背景を使用します。")
        return None
