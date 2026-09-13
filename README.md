# YouTube 動画自動生成パイプライン（楽々脳活）

「楽々脳活」（脳科学研究家 かみき♪ さんのチャンネル）向けに、
「台本生成 → 音声合成（TTS） → 動画合成（Shorts縦型） → YouTube アップロード」
を毎日自動で行うパイプラインです。GitHub Actions での定期実行を前提に構築しています。

台本フォーマットは、Googleドライブに保存されていた「脳科学ショート動画：
1ヶ月ネタカレンダー」の構成（【タイトル】→【衝撃的な結論】→【理由】→
【具体例】→【解説文】→【ハッシュタグ】）をテンプレート化したものです。
`config/topics.yaml` には、そのネタカレンダーの30日分をあらかじめ登録済みなので、
毎日1本ずつ実行すれば1ヶ月分の投稿がそのまま自動化できます。

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
# ffmpeg はrequirements.txtの imageio-ffmpeg が自動でバイナリを用意するため、
# 通常は追加インストール不要。うまく検出されない場合のみ以下を実行:
# sudo apt-get install -y ffmpeg

cp .env.example .env
# .env を編集（最初は DRY_RUN=true のままでOK。APIキー無しでも動作確認可能）

python main.py
```

- `ANTHROPIC_API_KEY` が無い場合は台本生成が簡易テンプレートにフォールバックします。
- `TTS_PROVIDER=gtts`（デフォルト）はAPIキー不要で音声合成できます。
- `DRY_RUN=true` の間は YouTube への実アップロードは行われず、ログ出力のみです。
- 生成された動画は `output/` に保存されます（gitには含まれません）。

日本語フォントは [Noto Sans JP](https://fonts.google.com/noto/specimen/Noto+Sans+JP)
Bold を `assets/fonts/NotoSansJP-Bold.ttf` に同梱済みです（SIL Open Font License）。
別のフォントに差し替えたい場合は、そのファイルを `assets/fonts/` に置いて
`config/config.yaml` の `video.font_path` を合わせてください。

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

### 5. 完全自動投稿（毎日公開）にする

「人の手を介さず毎日公開」まで到達するには、以下の状態にしてください。

1. 上記の YouTube アップロード用 Secrets（`YOUTUBE_CLIENT_ID` 等）を設定済みであること。
2. リポジトリの **Settings → Secrets and variables → Actions → Variables** で
   `DRY_RUN` を `false` に設定する（これで初めて実際にアップロードされます）。
3. 必要に応じて `YOUTUBE_PRIVACY_STATUS` を `public` に設定する
   （未設定/`private`のままだと、投稿はされますが非公開のままになります）。
4. `.github/workflows/youtube-automation.yml` の `cron` はデフォルトで
   **毎日1回**（UTC 9:00 = 日本時間18:00）実行される設定です。投稿本数を増やしたい
   場合はここを調整してください（例: `0 0,9 * * *` で1日2回）。

`config/topics.yaml` には30日分のネタが登録済みなので、このままにしておけば
1日1本、1ヶ月分は手を加えずに自動投稿されます。30日分を使い切ったら
（すべて `status: done` になったら）、同じ形式で新しいテーマを追記してください
（かみき♪さんの過去の台本や新しいネタ帳を元にLLMに追加候補を考えさせるのもおすすめです）。

DRY_RUNをfalseにする変更は実際にYouTubeへ公開される操作なので、必ず内容を確認した上で
自分の意思で切り替えてください。

## 今後カスタマイズすると良い点

- ナレーターのキャラクター性（「かみき♪」らしい語り口・決め台詞など）をさらに
  `config/config.yaml` の `script.system_prompt` に反映させ、既存動画のトーンに寄せる。
- 背景を単色スライドではなく、脳科学系の画像/動画素材に差し替える（`video_assembly.py` を拡張）。
- 字幕の時間配分を、TTSプロバイダのタイムスタンプ機能を使ってより正確にする。
- `config/topics.yaml` のネタが尽きないよう、LLMに新しいネタ候補を自動生成させて追記する仕組みを追加する。
- ロングフォーム（15分級の「神希」トークシリーズのような）動画を作りたくなったら、
  `script.system_prompt` と `video`（横型に戻す）を別プロファイルとして用意する。
