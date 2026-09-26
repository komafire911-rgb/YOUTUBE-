"""音声 + 背景 + 字幕から動画（mp4）を合成する。"""

from __future__ import annotations

import logging
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps

from .image_generation import generate_background_image
from .settings import Settings
from .subtitles import build_captions

logger = logging.getLogger(__name__)


def _load_font(font_path: str, size: int) -> ImageFont.FreeTypeFont:
    try:
        return ImageFont.truetype(font_path, size)
    except OSError:
        logger.warning(
            "フォント '%s' が見つからないため、PIL のデフォルトフォントを使用します。"
            "日本語を綺麗に表示するには assets/fonts/ に日本語フォント（例: Noto Sans JP）を"
            "配置し、config/config.yaml の font_path を合わせてください。",
            font_path,
        )
        return ImageFont.load_default()


def _wrap_text(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.FreeTypeFont, max_width: int) -> list[str]:
    """1文字ずつ足していき、指定した幅を超えたら改行するシンプルな日本語向け折り返し。"""
    lines: list[str] = []
    current = ""
    for ch in text:
        trial = current + ch
        bbox = draw.textbbox((0, 0), trial, font=font)
        if bbox[2] - bbox[0] > max_width and current:
            lines.append(current)
            current = ch
        else:
            current = trial
    if current:
        lines.append(current)
    return lines


def _make_background_image(
    title: str,
    size: tuple[int, int],
    bg_color: tuple[int, int, int],
    font_path: str,
    font_size: int,
    photo_path: Path | None = None,
) -> Image.Image:
    if photo_path is not None:
        img = ImageOps.fit(Image.open(photo_path).convert("RGB"), size, method=Image.LANCZOS)
    else:
        img = Image.new("RGB", size, color=bg_color)
    draw = ImageDraw.Draw(img, "RGBA")
    font = _load_font(font_path, font_size)

    # タイトルを中央に折り返し描画
    max_width = int(size[0] * 0.8)
    lines = _wrap_text(draw, title, font, max_width)

    line_height = font_size + 20
    total_height = line_height * len(lines)
    y = (size[1] - total_height) // 2

    if photo_path is not None:
        # 写真の上に文字を乗せるので、視認性のための半透明の帯を敷く
        pad = 40
        draw.rectangle([0, y - pad, size[0], y + total_height + pad], fill=(0, 0, 0, 130))

    for line in lines:
        bbox = draw.textbbox((0, 0), line, font=font)
        x = (size[0] - (bbox[2] - bbox[0])) // 2
        draw.text((x, y), line, font=font, fill=(255, 255, 255))
        y += line_height

    return img


def _make_caption_image(
    text: str, size: tuple[int, int], font_path: str, font_size: int
) -> Image.Image:
    img = Image.new("RGBA", size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    font = _load_font(font_path, font_size)

    # 字幕チャンクが1行に収まらない場合に備えて折り返す
    max_width = int(size[0] * 0.86)
    lines = _wrap_text(draw, text, font, max_width)

    line_height = font_size + 12
    line_boxes = [draw.textbbox((0, 0), line, font=font) for line in lines]
    line_widths = [b[2] - b[0] for b in line_boxes]
    max_line_w = max(line_widths) if line_widths else 0
    total_text_h = line_height * len(lines)

    pad_x, pad_y = 30, 16
    box_x0 = (size[0] - max_line_w) // 2 - pad_x
    box_y0 = size[1] - int(size[1] * 0.18) - total_text_h - pad_y
    box_x1 = (size[0] + max_line_w) // 2 + pad_x
    box_y1 = box_y0 + total_text_h + pad_y * 2

    draw.rounded_rectangle([box_x0, box_y0, box_x1, box_y1], radius=12, fill=(0, 0, 0, 160))

    y = box_y0 + pad_y
    for line, bbox in zip(lines, line_boxes):
        w = bbox[2] - bbox[0]
        x = (size[0] - w) // 2
        draw.text((x, y - bbox[1]), line, font=font, fill=(255, 255, 255, 255))
        y += line_height

    return img


def build_video(
    title: str,
    body: str,
    audio_path: Path,
    output_path: Path,
    settings: Settings,
) -> Path:
    """音声・タイトル背景・字幕を合成して mp4 を書き出す。"""
    from moviepy.editor import AudioFileClip, CompositeVideoClip, ImageClip, afx

    cfg = settings.video_cfg
    size = (cfg["width"], cfg["height"])
    bg_color = tuple(cfg.get("background_color", [17, 17, 22]))
    font_path = str(settings.output_dir.parent / cfg["font_path"])
    title_font_size = cfg.get("font_size", 64)
    subtitle_font_size = cfg.get("subtitle_font_size", 48)

    audio_clip = AudioFileClip(str(audio_path))
    duration = audio_clip.duration

    bgm_path = cfg.get("bgm_path")
    if bgm_path:
        bgm_full_path = settings.output_dir.parent / bgm_path
        if bgm_full_path.exists():
            bgm_clip = AudioFileClip(str(bgm_full_path)).fx(afx.audio_loop, duration=duration)
            bgm_clip = bgm_clip.fx(afx.volumex, cfg.get("bgm_volume", 0.15))
            from moviepy.editor import CompositeAudioClip

            audio_clip = CompositeAudioClip([bgm_clip, audio_clip])
        else:
            logger.warning("BGM ファイルが見つかりません: %s", bgm_full_path)

    photo_path = generate_background_image(title, body, settings)
    bg_img = _make_background_image(title, size, bg_color, font_path, title_font_size, photo_path=photo_path)
    bg_img_path = settings.output_dir / "_bg_frame.png"
    bg_img.save(bg_img_path)
    background_clip = ImageClip(str(bg_img_path)).set_duration(duration)

    caption_clips = []
    captions = build_captions(body, duration)
    for cap in captions:
        cap_img = _make_caption_image(cap.text, size, font_path, subtitle_font_size)
        cap_img_path = settings.output_dir / f"_cap_{int(cap.start * 1000)}.png"
        cap_img.save(cap_img_path)
        clip = (
            ImageClip(str(cap_img_path))
            .set_start(cap.start)
            .set_duration(max(cap.end - cap.start, 0.1))
        )
        caption_clips.append(clip)

    composite = CompositeVideoClip([background_clip, *caption_clips], size=size).set_audio(audio_clip)
    composite = composite.set_duration(duration)

    composite.write_videofile(
        str(output_path),
        fps=cfg.get("fps", 30),
        codec="libx264",
        audio_codec="aac",
        logger=None,
    )

    # 一時的なフレーム画像を削除
    bg_img_path.unlink(missing_ok=True)
    if photo_path is not None:
        photo_path.unlink(missing_ok=True)
    for cap in captions:
        (settings.output_dir / f"_cap_{int(cap.start * 1000)}.png").unlink(missing_ok=True)

    return output_path
