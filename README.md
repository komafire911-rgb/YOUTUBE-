# YouTube 動画自動生成パイプライン

テーマを与えるだけで「台本生成 → 音声合成（TTS） → 動画合成 → YouTube アップロード」
を自動で行うパイプラインの基盤です。GitHub Actions での定期実行を前提に構築しています。

まだ動画のジャンル（解説・Shorts・スライドショー等）は未確定のため、汎用的な
パイプライン基盤として作られています。ジャンルが決まったら `config/config.yaml`
の台本生成プロンプトや動画レイアウトを調整してください。

## 構成

```
config/
  config.yaml     … パイプライン全体の設定（台本・TTS・動画・YouTube）
  topics.yaml     … 動画化するテーマのキュー（1件処理するたびに status を更新）
pipeline/
  script_generation.py … Claude API でテーマから台本を生成
  tts.py / providers/  … 台本を音声化（gTTS or ElevenLabs）
  subtitles.py          … 字幕チャンク分割
  video_assembly.py     … 音声 + 背景 + 字幕から mp4 を合成（MoviePy）
  youtube_upload.py     … YouTube Data API v3 へアップロード
main.py           … 上記を1本分実行するエントリーポイント
scripts/
  get_youtube_refresh_token.py … YouTube OAuth のリフレッシュトークン取得ヘルパー
.github/workflows/
  youtube-automation.yml … 定期実行ワークフロー（GitHub Actions）
```

## セットアップ

### 1. ローカルで動作確認する

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
sudo apt-get install -y ffmpeg   # MoviePy が動画書き出しに使用

cp .env.example .env
# .env を編集（最初は DRY_RUN=true のままでOK。APIキー無しでも動作確認可能）

python main.py
```

- `ANTHROPIC_API_KEY` が無い場合は台本生成が簡易テンプレートにフォールバックします。
- `TTS_PROVIDER=gtts`（デフォルト）はAPIキー不要で音声合成できます。
- `DRY_RUN=true` の間は YouTube への実アップロードは行われず、ログ出力のみです。
- 生成された動画は `output/` に保存されます（gitには含まれません）。

日本語を綺麗に表示するには、[Noto Sans JP](https://fonts.google.com/noto/specimen/Noto+Sans+JP)
などの日本語フォント（.ttf）を `assets/fonts/` に配置し、
`config/config.yaml` の `video.font_path` をそのパスに合わせてください。
未配置の場合はPILのデフォルトフォントで代用されます（日本語は文字化けします）。

### 2. テーマを追加する

`config/topics.yaml` に動画化したいテーマを追加します。パイプラインは
`status: pending` の先頭1件を処理し、完了後に `status: done` に更新します。

```yaml
topics:
  - id: "unique-id-002"
    title: "動画のタイトル"
    prompt: "台本生成に渡す内容の指示・要点"
    status: "pending"
```

### 3. 必要なAPIキーを用意する

| 用途 | 環境変数 | 必須/任意 |
|---|---|---|
| 台本生成（Claude） | `ANTHROPIC_API_KEY` | 任意（無いと簡易テンプレート） |
| TTS（ElevenLabs使用時） | `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID` | 任意（gTTSなら不要） |
| YouTubeアップロード | `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, `YOUTUBE_REFRESH_TOKEN` | アップロードする場合は必須 |

#### YouTube アップロードのセットアップ

1. [Google Cloud Console](https://console.cloud.google.com/) でプロジェクトを作成し、
   **YouTube Data API v3** を有効化する。
2. 「APIとサービス」→「認証情報」で OAuth クライアントID（種類: デスクトップアプリ）を作成し、
   `client_secret.json` をダウンロードする。
3. `client_secret.json` を `scripts/` フォルダに置き、以下を実行してブラウザで許可する。
   ```bash
   pip install google-auth-oauthlib
   python scripts/get_youtube_refresh_token.py
   ```
4. 表示された `YOUTUBE_CLIENT_ID` / `YOUTUBE_CLIENT_SECRET` / `YOUTUBE_REFRESH_TOKEN` を
   `.env`（ローカル）または GitHub Secrets（Actions）に設定する。

`client_secret.json` や `.env` は `.gitignore` 対象なので、絶対にコミットしないでください。

### 4. GitHub Actions で定期実行する

`.github/workflows/youtube-automation.yml` が毎日 UTC 9:00（日本時間18:00）に
自動実行します（`workflow_dispatch` で手動実行も可能）。

リポジトリの **Settings → Secrets and variables → Actions** で以下を設定してください。

- **Secrets**（機密情報）: `ANTHROPIC_API_KEY`, `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`,
  `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, `YOUTUBE_REFRESH_TOKEN`
- **Variables**（非機密の設定値、任意）: `DRY_RUN`（`true`/`false`）, `TTS_PROVIDER`
  （`gtts`/`elevenlabs`）, `YOUTUBE_PRIVACY_STATUS`（`public`/`unlisted`/`private`）

**重要**: `DRY_RUN` を `false` にして初めて実際にYouTubeへアップロードされます。
最初は `DRY_RUN=true`（デフォルト）のまま数回実行し、`output/*.mp4`
アーティファクトの内容を確認してから `false` に切り替えることを推奨します。

## 今後カスタマイズすると良い点

- 動画のジャンル（解説・Shorts・スライドショーなど）が決まったら
  `config/config.yaml` の `script.system_prompt` と `video` セクションを調整する。
- 背景を単色スライドではなく画像/動画素材に差し替える（`video_assembly.py` を拡張）。
- 字幕の時間配分を、TTSプロバイダのタイムスタンプ機能を使ってより正確にする。
- テーマの投入自体もLLMで自動生成し、`config/topics.yaml` に自動追加する。
