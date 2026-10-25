"""ジャービス起動: python -m jarvis.main [--voice-out] [--voice-in] [--persona PATH]"""
import argparse
import os
from pathlib import Path

from dotenv import load_dotenv

from jarvis.brain import Brain, load_persona

load_dotenv()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--persona", default=str(Path(__file__).parent / "personas" / "ai_hayato.yaml"))
    ap.add_argument("--voice-out", action="store_true", help="返答を音声で読み上げる")
    ap.add_argument("--voice-in", action="store_true", help="マイクから音声入力する")
    a = ap.parse_args()

    persona = load_persona(a.persona)
    brain = Brain(persona)
    voice_id = os.getenv(persona.get("voice", {}).get("voice_id_env", "JARVIS_VOICE_ID"), "")
    if a.voice_out and not voice_id:
        raise SystemExit("JARVIS_VOICE_ID が未設定です(.env を確認)")

    print(f"{persona['name']} 起動。終了は 'exit'。")
    while True:
        if a.voice_in:
            from jarvis.voice import listen
            try:
                text = listen()
            except Exception as e:
                print(f"聞き取れませんでした: {e}")
                continue
            print(f"> {text}")
        else:
            text = input("> ").strip()
        if text.lower() in {"exit", "quit", "終了"}:
            break
        if not text:
            continue
        out = brain.reply(text)
        print(f"{persona['name']}: {out}")
        if a.voice_out:
            from jarvis.voice import speak
            speak(out, voice_id)


if __name__ == "__main__":
    main()
