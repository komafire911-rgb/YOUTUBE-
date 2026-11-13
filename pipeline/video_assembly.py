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


# 行頭に来てはいけない文字（禁則）
_NO_LINE_START = "、。！？!?」』）)ー・ぁぃぅぇぉっゃゅょァィゥェォッャュョ％%"


# この文字の直後は改行しても読みやすい
_GOOD_BREAK_AFTER = "、。！？!?」』をはがにでもの"


def _text_width(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.FreeTypeFont) -> int:
    bbox = draw.textbbox((0, 0), text, font=font)
    return bbox[2] - bbox[0]


def _wrap_text(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.FreeTypeFont, max_width: int) -> list[str]:
    """日本語向けの折り返し。行の長さをなるべく揃え、行頭に句読点などが来ないようにする。"""
    # まず幅いっぱいまで詰めて、必要な行数を求める
    count, current = 1, ""
    for ch in text:
        if current and _text_width(draw, current + ch, font) > max_width:
            count += 1
            current = ch
        else:
            current += ch
    if count == 1:
        return [text]

    # 各行がほぼ同じ文字数になるように分け直す（最終行に1〜2文字だけ残るのを防ぐ）。
    # 区切りの良い位置を優先した結果どこかの行が幅を超えたら、行数を1つ増やしてやり直す。
    while True:
        lines = _balanced_lines(draw, text, font, max_width, count)
        if count >= len(text) or all(_text_width(draw, line, font) <= max_width for line in lines):
            return lines
        count += 1


def _balanced_lines(
    draw: ImageDraw.ImageDraw, text: str, font: ImageFont.FreeTypeFont, max_width: int, count: int
) -> list[str]:
    lines: list[str] = []
    rest = text
    for remaining in range(count, 1, -1):
        cut = -(-len(rest) // remaining)
        # 近くに区切りの良い位置（句読点・助詞の直後）があれば、そこで改行する
        for delta in (0, 1, -1, 2, -2, 3, -3):
            pos = cut + delta
            if 2 <= pos < len(rest) and rest[pos - 1] in _GOOD_BREAK_AFTER and rest[pos] not in _NO_LINE_START:
                cut = pos
                break
        while cut < len(rest) and rest[cut] in _NO_LINE_START:
            cut += 1
        while cut > 1 and _text_width(draw, rest[:cut], font) > max_width:
            cut -= 1
        lines.append(rest[:cut])
        rest = rest[cut:]
    if rest:
        lines.append(rest)
    return lines


# 単色背景の代わりに使うグラデーション配色（上の色, 下の色, アクセント色）
_PALETTES = [
    ((24, 32, 78), (86, 40, 120), (255, 200, 87)),
    ((10, 54, 84), (20, 110, 120), (255, 214, 102)),
    ((60, 22, 72), (150, 50, 90), (255, 190, 120)),
    ((16, 44, 60), (40, 90, 140), (140, 230, 210)),
    ((48, 28, 20), (140, 70, 40), (255, 220, 130)),
]


def _make_designed_background(title: str, size: tuple[int, int]) -> tuple[Image.Image, tuple[int, int, int]]:
    """APIを使わずに描く、グラデーション＋光の円のデザイン背景。タイトルごとに配色が変わる。"""
    import zlib

    seed = zlib.crc32(title.encode("utf-8"))
    top, bottom, accent = _PALETTES[seed % len(_PALETTES)]
    w, h = size
    column = Image.new("RGB", (1, h))
    for y in range(h):
        t = y / max(h - 1, 1)
        column.putpixel((0, y), tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3)))
    img = column.resize((w, h))

    # ぼんやり光る円をいくつか重ねて、のっぺりした印象を避ける
    from PIL import ImageFilter

    glow = Image.new("RGBA", size, (0, 0, 0, 0))
    gdraw = ImageDraw.Draw(glow)
    for i in range(6):
        v = zlib.crc32(f"{title}-{i}".encode("utf-8"))
        cx, cy = v % w, (v >> 8) % h
        r = 140 + (v >> 16) % 260
        color = accent if i % 2 == 0 else (255, 255, 255)
        gdraw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(*color, 46))
    glow = glow.filter(ImageFilter.GaussianBlur(60))
    img = Image.alpha_composite(img.convert("RGBA"), glow).convert("RGB")
    return img, accent


def _make_background_image(
    title: str,
    size: tuple[int, int],
    bg_color: tuple[int, int, int],
    font_path: str,
    font_size: int,
    photo_path: Path | None = None,
    channel_name: str = "",
) -> Image.Image:
    if photo_path is not None:
        img = ImageOps.fit(Image.open(photo_path).convert("RGB"), size, method=Image.LANCZOS)
        accent = (255, 255, 255)
    else:
        img, accent = _make_designed_background(title, size)
    draw = ImageDraw.Draw(img, "RGBA")
    font = _load_font(font_path, font_size)

    # タイトルを中央に折り返し描画
    max_width = int(size[0] * 0.8)
    lines = _wrap_text(draw, title, font, max_width)

    line_height = font_size + 20
    total_height = line_height * len(lines)
    # タイトルは画面の上寄りに置き、中央〜下を字幕のために空ける
    y = int(size[1] * 0.16)

    # 視認性のための半透明カードと、上部のアクセント線
    pad = 50
    card = [int(size[0] * 0.06), y - pad, int(size[0] * 0.94), y + total_height + pad]
    draw.rounded_rectangle(card, radius=36, fill=(0, 0, 0, 120))
    draw.rounded_rectangle([card[0] + 60, card[1] - 6, card[2] - 60, card[1] + 6], radius=6, fill=(*accent, 255))

    if channel_name:
        small = _load_font(font_path, 40)
        bbox = draw.textbbox((0, 0), channel_name, font=small)
        draw.text(((size[0] - (bbox[2] - bbox[0])) // 2, int(size[1] * 0.93)), channel_name, font=small, fill=(255, 255, 255, 200))

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

    pad_x, pad_y = 40, 26
    box_x0 = (size[0] - max_line_w) // 2 - pad_x
    box_y0 = int(size[1] * 0.62) - total_text_h // 2 - pad_y
    box_x1 = (size[0] + max_line_w) // 2 + pad_x
    box_y1 = box_y0 + total_text_h + pad_y * 2

    draw.rounded_rectangle([box_x0, box_y0, box_x1, box_y1], radius=24, fill=(0, 0, 0, 170))

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
    bg_img = _make_background_image(
        title,
        size,
        bg_color,
        font_path,
        title_font_size,
        photo_path=photo_path,
        channel_name=cfg.get("channel_name", ""),
    )
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
