import logging
import os

from anthropic import Anthropic
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY")
MODEL = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-5")
client = Anthropic(api_key=ANTHROPIC_API_KEY) if ANTHROPIC_API_KEY else None

FALLBACK_ANSWER = (
    "現在この機能を利用できません(APIキー未設定、または一時的なエラーです)。"
    "しばらく待ってから再試行してください。"
)


def _build_system_prompt(university: str, faculty: str, department: str) -> str:
    target = f"{university} {faculty}"
    if department.strip():
        target += f" {department.strip()}"

    return (
        "あなたは日本の大学生向けに、大学の授業内容について答える案内AIです。\n"
        f"現在の相談対象は「{target}」です。\n"
        "一般的に知られている学部・学科のカリキュラムや授業の傾向をもとに、"
        "学生が気になる授業内容についてわかりやすく具体的に答えてください。\n"
        "科目の前提関係・学年ごとの学びの流れ・分野構成など、構造やつながりを説明する質問では、"
        "文章だけに頼らず、Mermaid記法のコードブロック(```mermaid ... ```)を積極的に使って図解してください"
        "(例: flowchartで科目の前提関係や学年進行、mindmapで分野構成を示す)。"
        "図は要点が伝わる範囲で簡潔にし、図の後に短い補足説明を添えてください。"
        "単純な一問一答で図解が不要な質問では、無理に図を使わず文章で答えてください。\n"
        "これはAIの一般的な知識にもとづく参考情報であり、実際のシラバスや最新のカリキュラムとは"
        "異なる場合があります。回答の最後に一言その旨を添えてください。\n"
        "です・ます調で、簡潔に答えてください。"
    )


def answer_course_question(university: str, faculty: str, department: str, messages: list) -> dict:
    """大学・学部・学科について、Claudeに授業内容を尋ねた回答を返す。

    Claudeが未設定/呼び出し失敗の場合は、その旨を伝えるフォールバック回答を返す
    (outline.generate_outlineと同じ方針)。
    """
    no_usage = {"input_tokens": 0, "output_tokens": 0}

    if client is None:
        return {"answer": FALLBACK_ANSWER, "_token_usage": no_usage}

    system_prompt = _build_system_prompt(university, faculty, department)
    claude_messages = [{"role": m["role"], "content": m["content"]} for m in messages]

    try:
        resp = client.messages.create(
            model=MODEL,
            max_tokens=1500,
            system=system_prompt,
            messages=claude_messages,
        )
        text_block = next((b for b in resp.content if b.type == "text"), None)
        answer = text_block.text.strip() if text_block else FALLBACK_ANSWER
        return {
            "answer": answer,
            "_token_usage": {
                "input_tokens": resp.usage.input_tokens,
                "output_tokens": resp.usage.output_tokens,
            },
        }
    except Exception:
        logger.warning(
            "Claude呼び出しに失敗したため授業案内のフォールバック回答を返します(university=%r, faculty=%r)",
            university,
            faculty,
            exc_info=True,
        )
        return {"answer": FALLBACK_ANSWER, "_token_usage": no_usage}
