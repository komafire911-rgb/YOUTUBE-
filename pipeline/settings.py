"""設定読み込み（config/config.yaml + 環境変数）。"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml
from dotenv import load_dotenv

REPO_ROOT = Path(__file__).resolve().parent.parent
CONFIG_PATH = REPO_ROOT / "config" / "config.yaml"
TOPICS_PATH = REPO_ROOT / "config" / "topics.yaml"

# .env があれば読み込む（無くてもエラーにしない。GitHub Actions では Secrets を使う）
load_dotenv(REPO_ROOT / ".env")


def _str_to_bool(value: str | None, default: bool = False) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def load_yaml_config() -> dict[str, Any]:
    with open(CONFIG_PATH, encoding="utf-8") as f:
        return yaml.safe_load(f)


@dataclass
class Settings:
    """パイプライン全体で使う設定値。環境変数が config.yaml の値を上書きする。"""

    raw: dict[str, Any] = field(default_factory=load_yaml_config)

    # 動作モード
    dry_run: bool = field(default_factory=lambda: _str_to_bool(os.getenv("DRY_RUN"), True))

    # 台本生成
    anthropic_api_key: str | None = field(default_factory=lambda: os.getenv("ANTHROPIC_API_KEY"))

    # TTS
    tts_provider: str = field(default_factory=lambda: os.getenv("TTS_PROVIDER", "gtts"))
    elevenlabs_api_key: str | None = field(default_factory=lambda: os.getenv("ELEVENLABS_API_KEY"))
    elevenlabs_voice_id: str | None = field(default_factory=lambda: os.getenv("ELEVENLABS_VOICE_ID"))

    # YouTube
    youtube_client_id: str | None = field(default_factory=lambda: os.getenv("YOUTUBE_CLIENT_ID"))
    youtube_client_secret: str | None = field(default_factory=lambda: os.getenv("YOUTUBE_CLIENT_SECRET"))
    youtube_refresh_token: str | None = field(default_factory=lambda: os.getenv("YOUTUBE_REFRESH_TOKEN"))
    youtube_privacy_status: str | None = field(default_factory=lambda: os.getenv("YOUTUBE_PRIVACY_STATUS"))

    @property
    def output_dir(self) -> Path:
        d = REPO_ROOT / self.raw.get("output_dir", "output")
        d.mkdir(parents=True, exist_ok=True)
        return d

    @property
    def script_cfg(self) -> dict[str, Any]:
        return self.raw["script"]

    @property
    def tts_cfg(self) -> dict[str, Any]:
        cfg = dict(self.raw["tts"])
        cfg["provider"] = self.tts_provider or cfg.get("provider", "gtts")
        return cfg

    @property
    def video_cfg(self) -> dict[str, Any]:
        return self.raw["video"]

    @property
    def youtube_cfg(self) -> dict[str, Any]:
        cfg = dict(self.raw["youtube"])
        if self.youtube_privacy_status:
            cfg["privacy_status"] = self.youtube_privacy_status
        return cfg


def get_settings() -> Settings:
    return Settings()
