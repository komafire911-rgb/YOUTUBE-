"""音声入出力。TTSは ElevenLabs、STTは SpeechRecognition(任意)。"""
import os
import shutil
import subprocess
import tempfile
import requests


def speak(text: str, voice_id: str) -> None:
    key = os.environ["ELEVENLABS_API_KEY"]
    r = requests.post(
        f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}",
        headers={"xi-api-key": key, "Accept": "audio/mpeg"},
        json={"text": text, "model_id": "eleven_multilingual_v2"},
        timeout=60,
    )
    r.raise_for_status()
    with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as f:
        f.write(r.content)
    player = shutil.which("ffplay") or shutil.which("mpg123")
    if player:
        args = [player, "-nodisp", "-autoexit", f.name] if "ffplay" in player else [player, f.name]
        subprocess.run(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    else:
        print(f"(再生プレイヤー未検出。音声ファイル: {f.name})")


def listen() -> str:
    import speech_recognition as sr

    r = sr.Recognizer()
    with sr.Microphone() as src:
        print("🎤 聞いています...")
        audio = r.listen(src, phrase_time_limit=15)
    return r.recognize_google(audio, language="ja-JP")
