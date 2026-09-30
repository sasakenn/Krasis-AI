"""
task_estimator.py
------------------
学習タスクの説明文から、完了までの目安時間(分)をClaudeに見積もらせるモジュール。

outline.py と同じ方針: Claudeが使えない(APIキー未設定・呼び出し失敗)場合でも
固定の目安時間にフォールバックし、機能自体は止めない。
"""

from __future__ import annotations

import json
import logging
import os

from anthropic import Anthropic
from dotenv import load_dotenv

from lang_utils import normalize_lang

load_dotenv()

logger = logging.getLogger(__name__)

ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY")
MODEL = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-5")
client = Anthropic(api_key=ANTHROPIC_API_KEY) if ANTHROPIC_API_KEY else None

# Claude未使用時のフォールバック目安(分)。
_FALLBACK_MINUTES = 60
_FALLBACK_REASONING = {
    "ja": "AIによる見積もりが利用できなかったため、暫定的な目安時間です。",
    "en": "AI estimation was unavailable, so this is a provisional estimate.",
    "ko": "AI 추정을 이용할 수 없어 잠정적인 예상 시간입니다.",
}

_REASONING_LANGUAGE_HINT = {
    "ja": "見積もりの根拠(1〜2文、日本語)",
    "en": "the reasoning for the estimate (1-2 sentences, in English)",
    "ko": "예상 근거(1~2문장, 한국어)",
}


def _build_prompt(description: str, lang: str) -> str:
    lang = normalize_lang(lang)
    return f"""あなたは大学生の学習・課題管理を支援するアシスタントです。

以下のタスクについて、大学生が集中して取り組んだ場合に完了までかかる時間を見積もってください。

タスク内容: {description}

要件:
- JSONのみを返す(前後に説明文やコードブロック記号は付けない)
- 出力形式:
{{
  "estimated_minutes": 完了までの目安分数(整数),
  "reasoning": "{_REASONING_LANGUAGE_HINT[lang]}"
}}
- 現実的な学生の作業ペースを想定し、極端に短すぎたり長すぎたりしない値にする"""


def _parse_response(raw_text: str) -> dict:
    text = raw_text.strip()
    if text.startswith("```"):
        text = text.split("```", 2)[1].replace("json", "", 1).strip() if "```" in text else text
    return json.loads(text)


def _fallback_result(lang: str = "ja") -> dict:
    return {
        "estimated_minutes": _FALLBACK_MINUTES,
        "reasoning": _FALLBACK_REASONING[normalize_lang(lang)],
        "_token_usage": {"input_tokens": 0, "output_tokens": 0},
    }


def estimate_task_duration(description: str, lang: str = "ja") -> dict:
    """タスクの説明文から {"estimated_minutes", "reasoning", "_token_usage"} を返す。langで
    指定した言語(ja/en/ko)でreasoningを書かせる。

    _token_usage は呼び出し元(app.py)が課金/クォータ管理に使う内部情報で、
    クライアントへのレスポンスに含める前にpopして取り除く想定。
    """
    clean = description.strip()
    lang = normalize_lang(lang)

    if client is None:
        return _fallback_result(lang)

    try:
        resp = client.messages.create(
            model=MODEL,
            max_tokens=300,
            messages=[{"role": "user", "content": _build_prompt(clean, lang)}],
        )
        text_block = next(block for block in resp.content if block.type == "text")
        result = _parse_response(text_block.text)
        estimated_minutes = max(int(result.get("estimated_minutes", _FALLBACK_MINUTES)), 1)
        reasoning = str(result.get("reasoning", ""))
        return {
            "estimated_minutes": estimated_minutes,
            "reasoning": reasoning,
            "_token_usage": {
                "input_tokens": resp.usage.input_tokens,
                "output_tokens": resp.usage.output_tokens,
            },
        }
    except Exception:
        logger.warning(
            "Claude呼び出しに失敗したためフォールバックの見積もりを返します(description=%r)",
            clean,
            exc_info=True,
        )
        return _fallback_result(lang)
