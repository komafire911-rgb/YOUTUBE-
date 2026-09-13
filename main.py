#!/usr/bin/env python3
"""YouTube 動画自動生成パイプラインのエントリーポイント。

台本生成 -> TTS -> 動画合成 -> YouTube アップロード を1本分実行する。
config/topics.yaml の先頭にある status: pending のテーマを1件処理する。

使い方:
    python main.py

環境変数（.env またはGitHub Secrets）で API キーや DRY_RUN を制御する。
詳細は README.md を参照。
"""

from __future__ import annotations

import logging
import sys
from datetime import datetime

from pipeline.settings import get_settings
from pipeline.script_generation import generate_script
from pipeline.tts import synthesize_speech
from pipeline.topics import mark_topic_status, next_pending_topic
from pipeline.video_assembly import build_video
from pipeline.youtube_upload import upload_video

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("main")


def run_once() -> int:
    settings = get_settings()
    logger.info("パイプライン開始（DRY_RUN=%s, TTS_PROVIDER=%s）", settings.dry_run, settings.tts_provider)

    topic = next_pending_topic()
    if topic is None:
        logger.info("処理対象のテーマがありません（config/topics.yaml に status: pending の項目を追加してください）。")
        return 0

    logger.info("テーマ取得: %s - %s", topic.id, topic.title)

    try:
        script = generate_script(topic.title, topic.prompt, settings)
        logger.info("台本生成完了（%d文字）", len(script.body))

        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        base_name = f"{timestamp}_{topic.id}"

        audio_path = settings.output_dir / f"{base_name}.mp3"
        synthesize_speech(script.body, audio_path, settings)
        logger.info("音声合成完了: %s", audio_path)

        video_path = settings.output_dir / f"{base_name}.mp4"
        build_video(script.title, script.body, audio_path, video_path, settings)
        logger.info("動画合成完了: %s", video_path)

        upload_video(
            video_path=video_path,
            title=script.title,
            description=script.youtube_description,
            settings=settings,
        )

        mark_topic_status(topic.id, "done")
        logger.info("テーマ %s の処理が完了しました。", topic.id)
        return 0

    except Exception:
        logger.exception("パイプライン処理中にエラーが発生しました（テーマ: %s）", topic.id)
        mark_topic_status(topic.id, "failed")
        return 1


if __name__ == "__main__":
    sys.exit(run_once())
