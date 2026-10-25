"""会話の頭脳: ペルソナ設定を system プロンプトにして Claude と対話する。"""
import os
import yaml
import anthropic

MODEL = os.getenv("JARVIS_MODEL", "claude-sonnet-5-5")


def load_persona(path: str) -> dict:
    with open(path, encoding="utf-8") as f:
        return yaml.safe_load(f)


def build_system_prompt(p: dict) -> str:
    lines = [
        f"あなたは「{p['name']}」というAIキャラクターとして、ユーザーのパーソナルAIアシスタント(ジャービス)を務めます。",
        f"一人称: {p.get('first_person', '私')} / ユーザーの呼び方: {p.get('user_call', 'あなた')}",
        f"口調: {p.get('tone', '')}",
        f"背景設定:\n{p.get('background', '')}",
    ]
    if p.get("catchphrases"):
        lines.append("口癖: " + " / ".join(p["catchphrases"]))
    lines.append("ルール:")
    lines += [f"- {r}" for r in p.get("rules", [])]
    return "\n".join(lines)


class Brain:
    def __init__(self, persona: dict):
        self.client = anthropic.Anthropic()
        self.system = build_system_prompt(persona)
        self.history: list[dict] = []

    def reply(self, user_text: str) -> str:
        self.history.append({"role": "user", "content": user_text})
        res = self.client.messages.create(
            model=MODEL, max_tokens=400, system=self.system, messages=self.history
        )
        text = "".join(b.text for b in res.content if b.type == "text")
        self.history.append({"role": "assistant", "content": text})
        return text
