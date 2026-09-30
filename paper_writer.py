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
FALLBACK_BODY = (
    "現在この機能を利用できません(APIキー未設定、または一時的なエラーです)。"
    "しばらく待ってから再試行してください。"
)

_PAPER_BODY_LANGUAGE_REQUIREMENT = {
    "ja": "- 日本語で執筆する",
    "en": "- Write in English",
    "ko": "- 한국어로 작성할 것",
}

# 分量帯(outline.LENGTH_OPTIONSのkeyと対応)ごとの本文生成の出力上限。
# 日本語は1文字あたり1トークンより多く消費しがちなので、目安の文字数より余裕を持たせる。
MAX_TOKENS_BY_LENGTH = {
    "1-100": 500,
    "101-1000": 2000,
    "1001-3000": 4000,
    "3001-5000": 6000,
    "5001-10000": 8000,
}
DEFAULT_MAX_TOKENS = 4000


def _format_literature(section: dict) -> str:
    papers = section.get("literature") or []
    if not papers:
        return "(この節で参照できる文献は見つかりませんでした)"

    lines = []
    for paper in papers:
        authors = ", ".join(paper.get("authors") or []) or "著者不明"
        year = paper.get("year")
        year_part = f" ({year})" if year else ""
        lines.append(f"- {paper.get('title', '(タイトル不明)')} — {authors}{year_part}")
    return "\n".join(lines)


def _build_prompt(title: str, research_question: str, sections: list, target_length: str, lang: str) -> str:
    section_blocks = []
    for i, section in enumerate(sections, start=1):
        section_blocks.append(
            f"{i}. {section.get('heading', '')}\n"
            f"   節の狙い: {section.get('purpose', '')}\n"
            f"   参考文献:\n{_format_literature(section)}"
        )
    sections_text = "\n\n".join(section_blocks)

    length_block = (
        f"\n\n想定分量: 本文全体で{target_length.replace('-', '〜')}文字程度を目安にする。\n"
        if target_length.strip()
        else ""
    )

    return f"""あなたは学術的な文章の執筆を支援する研究アシスタントです。

以下の調査計画(タイトル・中心の問い・各節の構成と参考文献)にもとづき、
実際に読める論文の本文を執筆してください(構成案の再掲ではなく、完成した文章にすること)。

タイトル: {title}
中心の問い: {research_question}

節構成と参考文献:
{sections_text}
{length_block}
要件:
{_PAPER_BODY_LANGUAGE_REQUIREMENT[normalize_lang(lang)]}
- 先頭にタイトルを「# タイトル」の形式で1行だけ書く
- 各節の見出しは必ず「## 節番号. 見出し」の形式にする(例: 「## 1. 背景」)。
  番号付きの見出しを地の文として書かず、必ずこの##形式にすること
- 見出しの下に本文の段落を書く(見出しの後に空行を入れる)
- 各節で示された参考文献を、可能な範囲で本文中に(著者名, 出版年)の形式で引用する
  (文献が「見つかりませんでした」の節は、無理に引用せず一般的な議論として書く)
- 前後に説明文やJSON・コードブロック記号は付けず、本文のMarkdownのみを返す
- 冒頭に導入(本文全体の狙いを1段落程度)、末尾に結論(2〜3文程度)を含める
"""


def generate_paper_body(
    title: str,
    research_question: str,
    sections: list,
    target_length: str = "",
    lang: str = "ja",
) -> dict:
    """調査計画(アウトライン)から、実際に読める論文の本文を生成する。langで指定した
    言語(ja/en/ko)で執筆させる。

    Claudeが未設定/呼び出し失敗の場合は、その旨を伝えるフォールバック回答を返す
    (course_guide.answer_course_questionと同じ方針)。
    """
    no_usage = {"input_tokens": 0, "output_tokens": 0}
    lang = normalize_lang(lang)

    if client is None:
        return {"body": fallback_answer(lang), "_token_usage": no_usage}

    prompt = _build_prompt(title, research_question, sections, target_length, lang)
    max_tokens = MAX_TOKENS_BY_LENGTH.get(target_length, DEFAULT_MAX_TOKENS)

    try:
        resp = client.messages.create(
            model=MODEL,
            max_tokens=max_tokens,
            messages=[{"role": "user", "content": prompt}],
        )
        text_block = next((b for b in resp.content if b.type == "text"), None)
        body = text_block.text.strip() if text_block else fallback_answer(lang)
        return {
            "body": body,
            "_token_usage": {
                "input_tokens": resp.usage.input_tokens,
                "output_tokens": resp.usage.output_tokens,
            },
        }
    except Exception:
        logger.warning(
            "Claude呼び出しに失敗したため本文生成のフォールバック回答を返します(title=%r)",
            title,
            exc_info=True,
        )
        return {"body": fallback_answer(lang), "_token_usage": no_usage}
