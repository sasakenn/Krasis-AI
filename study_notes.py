import logging
import os

from anthropic import Anthropic
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY")
MODEL = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-5")
client = Anthropic(api_key=ANTHROPIC_API_KEY) if ANTHROPIC_API_KEY else None

FALLBACK_CONTENT = (
    "現在この機能を利用できません(APIキー未設定、または一時的なエラーです)。"
    "しばらく待ってから再試行してください。"
)

MAX_TOKENS = 4000


def _build_prompt(document_text: str, focus: str) -> str:
    focus_block = f"\n特に重視してほしい観点: {focus}\n" if focus.strip() else ""

    return f"""あなたは学生・社会人の学習を支援する要点整理アシスタントです。
以下のレポート・資料を分析し、暗記すべき要点と全体の流れ(プロセス)を整理してください。
{focus_block}
--- 資料ここから ---
{document_text}
--- 資料ここまで ---

出力要件:
- 日本語で、Markdown形式のみを返す(前後の説明文やコードブロック記号は不要)
- 次の見出しをこの順番・この文言でちょうど1回ずつ使う(「## 」で始めること):
  ## 全体の要約
  ## 暗記すべき要点
  ## 流れ・プロセス
  ## 復習の質問
- 「## 全体の要約」: 資料全体を3〜5文程度で要約する
- 「## 暗記すべき要点」: 試験や実務で問われそうな重要な用語・数値・定義・因果関係を箇条書きにし、
  それぞれ一言その理由や背景を添える
- 「## 流れ・プロセス」: 資料に手順・時系列・因果関係が含まれる場合は、Mermaid記法のコードブロック
  (```mermaid ... ```)でflowchartを描く。単純な内容で流れと呼べるものがない場合は、
  無理に図を作らず要点を箇条書きで示す
- 「## 復習の質問」: 理解度を確認するための一問一答形式の質問を3〜5個、箇条書きで示す(答えは書かない)
"""


def generate_study_notes(document_text: str, focus: str = "") -> dict:
    """レポート・資料のテキストから、暗記すべき要点と流れの整理をClaudeに作らせる。

    Claudeが未設定/呼び出し失敗の場合は、その旨を伝えるフォールバック回答を返す
    (paper_writer.generate_paper_bodyと同じ方針)。
    """
    no_usage = {"input_tokens": 0, "output_tokens": 0}

    if client is None:
        return {"content": FALLBACK_CONTENT, "_token_usage": no_usage}

    prompt = _build_prompt(document_text, focus)

    try:
        resp = client.messages.create(
            model=MODEL,
            max_tokens=MAX_TOKENS,
            messages=[{"role": "user", "content": prompt}],
        )
        text_block = next((b for b in resp.content if b.type == "text"), None)
        content = text_block.text.strip() if text_block else FALLBACK_CONTENT
        return {
            "content": content,
            "_token_usage": {
                "input_tokens": resp.usage.input_tokens,
                "output_tokens": resp.usage.output_tokens,
            },
        }
    except Exception:
        logger.warning("Claude呼び出しに失敗したため要点整理のフォールバック回答を返します", exc_info=True)
        return {"content": FALLBACK_CONTENT, "_token_usage": no_usage}
