#!/usr/bin/env python3
"""YouTube アップロード用の OAuth リフレッシュトークンを取得するヘルパー。

事前に Google Cloud Console で OAuth クライアントID（デスクトップアプリ）を作成し、
client_secret.json をダウンロードしてこのスクリプトと同じ階層に置いてから実行する。
ブラウザが開くので Google アカウントでログイン・許可すると、
コンソールに refresh_token が表示される。それを .env / GitHub Secrets の
YOUTUBE_REFRESH_TOKEN に設定する。

使い方:
    python scripts/get_youtube_refresh_token.py
"""

from __future__ import annotations

from pathlib import Path

from google_auth_oauthlib.flow import InstalledAppFlow

SCOPES = ["https://www.googleapis.com/auth/youtube.upload"]
CLIENT_SECRET_FILE = Path(__file__).parent / "client_secret.json"


def main() -> None:
    if not CLIENT_SECRET_FILE.exists():
        raise SystemExit(
            f"'{CLIENT_SECRET_FILE}' が見つかりません。\n"
            "Google Cloud Console で OAuth クライアントID（デスクトップアプリ）を作成し、\n"
            "client_secret.json をこのスクリプトと同じディレクトリに配置してください。"
        )

    flow = InstalledAppFlow.from_client_secrets_file(str(CLIENT_SECRET_FILE), SCOPES)
    creds = flow.run_local_server(port=0)

    print("\n=== 取得結果（.env / GitHub Secrets に設定してください） ===")
    print(f"YOUTUBE_CLIENT_ID={creds.client_id}")
    print(f"YOUTUBE_CLIENT_SECRET={creds.client_secret}")
    print(f"YOUTUBE_REFRESH_TOKEN={creds.refresh_token}")


if __name__ == "__main__":
    main()
