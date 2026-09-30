import logging
import os

from anthropic import Anthropic
from dotenv import load_dotenv

from lang_utils import fallback_answer, normalize_lang

load_dotenv()

logger = logging.getLogger(__name__)

ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY")
MODEL = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-5")
client = Anthropic(api_key=ANTHROPIC_API_KEY) if ANTHROPIC_API_KEY else None

# 後方互換用(既存のimport元向け)。実際の表示にはlang別のfallback_answer()を使う。
FALLBACK_CONTENT = (
    "現在この機能を利用できません(APIキー未設定、または一時的なエラーです)。"
    "しばらく待ってから再試行してください。"
)

MAX_TOKENS = 4000

_INSTRUCTIONS = {
    "ja": """あなたは学生・社会人の学習を支援する要点整理アシスタントです。
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
""",
    "en": """You are a study-support assistant that helps students and professionals organize key points.
Analyze the report/material below and organize the points worth memorizing and the overall flow (process).
{focus_block}
--- Material starts ---
{document_text}
--- Material ends ---

Output requirements:
- Respond in English, Markdown only (no surrounding explanation or code fences)
- Use exactly these headings once each, in this order (start each with "## "):
  ## Overall summary
  ## Key points to memorize
  ## Flow / process
  ## Review questions
- "## Overall summary": summarize the whole material in about 3-5 sentences
- "## Key points to memorize": bullet the important terms, numbers, definitions and causal relationships likely
  to be tested, each with a one-line reason or context
- "## Flow / process": if the material contains steps, a timeline, or causal relationships, draw a flowchart in a
  Mermaid code block (```mermaid ... ```). If there is no real flow to show, list the key points as bullets instead
- "## Review questions": give 3-5 bullet-point Q&A-style questions to check understanding (do not include answers)
""",
    "ko": """당신은 학생과 직장인의 학습을 돕는 핵심 정리 어시스턴트입니다.
아래 리포트·자료를 분석하여 암기해야 할 핵심과 전체 흐름(프로세스)을 정리해 주세요.
{focus_block}
--- 자료 시작 ---
{document_text}
--- 자료 끝 ---

출력 요건:
- 한국어로, Markdown 형식만 반환할 것(앞뒤 설명문이나 코드블록 기호는 불필요)
- 다음 제목을 이 순서·문구로 정확히 한 번씩 사용할 것("## "로 시작):
  ## 전체 요약
  ## 암기해야 할 핵심
  ## 흐름·프로세스
  ## 복습 질문
- "## 전체 요약": 자료 전체를 3~5문장 정도로 요약
- "## 암기해야 할 핵심": 시험이나 실무에서 물어볼 만한 중요한 용어·수치·정의·인과관계를 불릿으로 정리하고,
  각각에 한 줄 이유나 배경을 덧붙임
- "## 흐름·프로세스": 자료에 절차·시계열·인과관계가 포함된 경우, Mermaid 표기법 코드블록
  (```mermaid ... ```)으로 flowchart를 그림. 단순한 내용으로 흐름이라 할 것이 없으면
  무리하게 그림을 만들지 말고 핵심을 불릿으로 제시
- "## 복습 질문": 이해도를 확인하기 위한 일문일답 형식의 질문을 3~5개, 불릿으로 제시(답은 쓰지 않음)
""",
}

_FOCUS_LABEL = {
    "ja": "特に重視してほしい観点: {focus}",
    "en": "Aspects to focus on: {focus}",
    "ko": "특히 중점을 두었으면 하는 관점: {focus}",
}


def _build_prompt(document_text: str, focus: str, lang: str) -> str:
    lang = normalize_lang(lang)
    focus_block = f"\n{_FOCUS_LABEL[lang].format(focus=focus)}\n" if focus.strip() else ""
    return _INSTRUCTIONS[lang].format(focus_block=focus_block, document_text=document_text)


def generate_study_notes(document_text: str, focus: str = "", lang: str = "ja") -> dict:
    """レポート・資料のテキストから、暗記すべき要点と流れの整理をClaudeに作らせる。langで
    指定した言語(ja/en/ko)で出力させる。

    Claudeが未設定/呼び出し失敗の場合は、その旨を伝えるフォールバック回答を返す
    (paper_writer.generate_paper_bodyと同じ方針)。
    """
    no_usage = {"input_tokens": 0, "output_tokens": 0}

    if client is None:
        return {"content": fallback_answer(lang), "_token_usage": no_usage}

    prompt = _build_prompt(document_text, focus, lang)

    try:
        resp = client.messages.create(
            model=MODEL,
            max_tokens=MAX_TOKENS,
            messages=[{"role": "user", "content": prompt}],
        )
        text_block = next((b for b in resp.content if b.type == "text"), None)
        content = text_block.text.strip() if text_block else fallback_answer(lang)
        return {
            "content": content,
            "_token_usage": {
                "input_tokens": resp.usage.input_tokens,
                "output_tokens": resp.usage.output_tokens,
            },
        }
    except Exception:
        logger.warning("Claude呼び出しに失敗したため要点整理のフォールバック回答を返します", exc_info=True)
        return {"content": fallback_answer(lang), "_token_usage": no_usage}
