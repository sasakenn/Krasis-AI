import logging
import os

from anthropic import Anthropic
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY")
MODEL = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-5")
client = Anthropic(api_key=ANTHROPIC_API_KEY) if ANTHROPIC_API_KEY else None

_NO_REQUEST_MARKER = "NONE"

_SYSTEM_PROMPT = (
    "あなたはサービスへの入力を最初に見る判定役です。ユーザーの発言が、"
    "依頼・質問・トピックなど実質的な内容を一切含まない、感嘆文や相槌、短い感想"
    "(例:「いいね」「すごい」「ありがとう」「助かる」など)だけである場合は、"
    "それに対する短く自然な一言の返答だけを出力してください。\n"
    "少しでも実質的な依頼・質問・トピックが含まれる場合は、他には何も書かず"
    f"「{_NO_REQUEST_MARKER}」とだけ出力してください。"
)


def brush_off_if_exclamation(text: str) -> dict:
    """入力が実質的な依頼を含まない感嘆文・相槌だけの場合、短い返答を返す。

    実質的な内容を含む場合や、Claude未設定/呼び出し失敗時はreply=Noneを返し、
    呼び出し元は通常のフロー(質問への回答・アウトライン生成など)を続行する。
    """
    no_usage = {"input_tokens": 0, "output_tokens": 0}
    stripped = (text or "").strip()
    if not stripped or client is None:
        return {"reply": None, "_token_usage": no_usage}

    try:
        resp = client.messages.create(
            model=MODEL,
            max_tokens=100,
            system=_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": stripped}],
        )
        text_block = next((b for b in resp.content if b.type == "text"), None)
        reply = text_block.text.strip() if text_block else ""
        usage = {
            "input_tokens": resp.usage.input_tokens,
            "output_tokens": resp.usage.output_tokens,
        }
        if not reply or _NO_REQUEST_MARKER in reply:
            return {"reply": None, "_token_usage": usage}
        return {"reply": reply, "_token_usage": usage}
    except Exception:
        logger.warning("Claude呼び出しに失敗したため感嘆文判定をスキップします", exc_info=True)
        return {"reply": None, "_token_usage": no_usage}
