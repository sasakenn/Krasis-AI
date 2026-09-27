import json
import logging
import os
import re

from anthropic import Anthropic
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY")
MODEL = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-5")
client = Anthropic(api_key=ANTHROPIC_API_KEY) if ANTHROPIC_API_KEY else None

# 関連文献パネルの言語セレクタで選べる翻訳先言語("natural"=原文表示はここに含めない)。
LANGUAGE_NAMES = {
    "en": "English",
    "ja": "Japanese",
    "zh": "Chinese (Simplified)",
    "es": "Spanish",
}

_JSON_ARRAY_RE = re.compile(r"\[.*\]", re.S)


def translate_titles(titles: list, target_lang: str) -> dict:
    """文献タイトルの一覧を指定言語へ翻訳する。

    Claude未設定/呼び出し失敗/応答が期待した形でない場合は、原文をそのまま返す
    (outline.generate_outlineなど他機能と同じフォールバック方針)。
    """
    no_usage = {"input_tokens": 0, "output_tokens": 0}
    if not titles:
        return {"titles": [], "_token_usage": no_usage}

    language_name = LANGUAGE_NAMES.get(target_lang)
    if client is None or language_name is None:
        return {"titles": list(titles), "_token_usage": no_usage}

    numbered = "\n".join(f"{i + 1}. {t}" for i, t in enumerate(titles))
    prompt = (
        f"次の学術文献タイトルの一覧を{language_name}に翻訳してください。\n"
        "固有名詞や専門用語は一般的な訳語を使い、意味を変えないでください。\n"
        "出力は入力と同じ件数・同じ順序のJSON配列(文字列のみ)にしてください。"
        "前置きや説明、番号付けは不要です。JSON配列だけを出力してください。\n\n"
        f"{numbered}"
    )

    try:
        resp = client.messages.create(
            model=MODEL,
            max_tokens=2000,
            messages=[{"role": "user", "content": prompt}],
        )
        text_block = next((b for b in resp.content if b.type == "text"), None)
        raw = text_block.text.strip() if text_block else ""
        match = _JSON_ARRAY_RE.search(raw)
        translated = json.loads(match.group(0)) if match else None
        if not isinstance(translated, list) or len(translated) != len(titles):
            raise ValueError("unexpected translation response shape")

        return {
            "titles": [str(t) for t in translated],
            "_token_usage": {
                "input_tokens": resp.usage.input_tokens,
                "output_tokens": resp.usage.output_tokens,
            },
        }
    except Exception:
        logger.warning(
            "Claude呼び出しに失敗したため文献タイトルの翻訳をスキップします(target_lang=%r)",
            target_lang,
            exc_info=True,
        )
        return {"titles": list(titles), "_token_usage": no_usage}
