"""YouTube Data API v3 への動画アップロード。

事前に OAuth2 のクライアントID/シークレット/リフレッシュトークンを取得しておく必要がある。
取得手順は README.md の「YouTube アップロードのセットアップ」を参照。
"""

from __future__ import annotations

import logging
from pathlib import Path

from .settings import Settings

logger = logging.getLogger(__name__)

SCOPES = ["https://www.googleapis.com/auth/youtube.upload"]


def _build_youtube_client(settings: Settings):
    from google.oauth2.credentials import Credentials
    from googleapiclient.discovery import build

    creds = Credentials(
        token=None,
        refresh_token=settings.youtube_refresh_token,
        client_id=settings.youtube_client_id,
        client_secret=settings.youtube_client_secret,
        token_uri="https://oauth2.googleapis.com/token",
        scopes=SCOPES,
    )
    return build("youtube", "v3", credentials=creds)


def upload_video(
    video_path: Path,
    title: str,
    description: str,
    settings: Settings,
) -> str | None:
    """動画をYouTubeにアップロードする。DRY_RUN時は実際には送信せずログのみ出す。

    戻り値: アップロードした動画のID（DRY_RUN時は None）
    """
    cfg = settings.youtube_cfg

    if settings.dry_run:
        logger.info(
            "[DRY_RUN] YouTube へのアップロードをスキップします。"
            " title=%r, privacy=%s, file=%s",
            title,
            cfg.get("privacy_status", "private"),
            video_path,
        )
        return None

    if not (settings.youtube_client_id and settings.youtube_client_secret and settings.youtube_refresh_token):
        raise RuntimeError(
            "YouTube アップロードには YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET / "
            "YOUTUBE_REFRESH_TOKEN の設定が必要です（README.md 参照）。"
        )

    from googleapiclient.http import MediaFileUpload

    youtube = _build_youtube_client(settings)

    body = {
        "snippet": {
            "title": title[:100],
            "description": description[:5000],
            "tags": cfg.get("default_tags", []),
            "categoryId": cfg.get("category_id", "22"),
        },
        "status": {
            "privacyStatus": cfg.get("privacy_status", "private"),
        },
    }

    media = MediaFileUpload(str(video_path), chunksize=-1, resumable=True, mimetype="video/mp4")
    request = youtube.videos().insert(part="snippet,status", body=body, media_body=media)

    response = None
    while response is None:
        status, response = request.next_chunk()
        if status:
            logger.info("アップロード進捗: %d%%", int(status.progress() * 100))

    video_id = response.get("id")
    logger.info("YouTube アップロード完了: https://youtu.be/%s", video_id)
    return video_id
