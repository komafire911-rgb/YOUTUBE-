# Jarvis (AIキャラクター型音声アシスタント)

```
pip install -r jarvis/requirements.txt
cp .env.example .env   # ANTHROPIC_API_KEY / ELEVENLABS_API_KEY / JARVIS_VOICE_ID を設定
python -m jarvis.main                 # テキスト会話
python -m jarvis.main --voice-out     # 返答を音声で読み上げ
python -m jarvis.main --voice-in --voice-out   # 音声で会話
```

- キャラクター: `jarvis/personas/*.yaml` を編集(口調・口癖・背景・ルール)。
- 声: ElevenLabs の `voice_id`。使用権を持つ声、または ElevenLabs の Voice Design で作った声を指定してください。
- 俳優本人の声のクローンは、本人の許諾がない限り作成しないでください。
