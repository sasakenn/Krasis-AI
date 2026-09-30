import logging
import os

from anthropic import Anthropic
from dotenv import load_dotenv

from lang_utils import RESPONSE_QUALITY_INSTRUCTION, fallback_answer, language_instruction

load_dotenv()

logger = logging.getLogger(__name__)

ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY")
MODEL = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-5")
client = Anthropic(api_key=ANTHROPIC_API_KEY) if ANTHROPIC_API_KEY else None

# 後方互換用(既存のimport元向け)。実際の表示にはlang別のfallback_answer()を使う。
FALLBACK_ANSWER = (
    "現在この機能を利用できません(APIキー未設定、または一時的なエラーです)。"
    "しばらく待ってから再試行してください。"
)

LEVEL_LABELS = {
    "beginner": "初学者(専門用語をほぼ知らない)",
    "intermediate": "中級者(基本的な経済用語は理解している)",
    "advanced": "上級者(マクロ経済・企業分析の知識がある)",
}

ROLE_LABELS = {
    "student": "学生",
    "employee": "会社員",
    "executive": "経営者",
    "founder": "起業家",
    "investor": "投資家",
    "researcher": "研究者",
    "other": "その他",
}

CATEGORY_LABELS = {
    "economics": "Economics(経済)",
    "finance": "Finance(金融・個別企業/市場)",
}

REGION_LABELS = {
    # Economics
    "japan": "日本",
    "us": "アメリカ",
    "world": "世界",
    # Finance
    "japan-stocks": "日本株",
    "us-stocks": "米国株",
}

# カテゴリーごとに選べる地域/市場(regionsのバリデーション・プロンプト生成の両方で使う)。
REGIONS_BY_CATEGORY = {
    "economics": ["japan", "us", "world"],
    "finance": ["japan-stocks", "us-stocks"],
}


def _build_system_prompt(level: str, role: str, purpose: str, categories: list, regions: dict, lang: str) -> str:
    level_label = LEVEL_LABELS.get(level, level)
    role_label = ROLE_LABELS.get(role, role)
    # 例: "Economics(経済)・日本 / Finance(金融・個別企業/市場)・日本株"
    selection_label = " / ".join(
        f"{CATEGORY_LABELS.get(cat, cat)}・{REGION_LABELS.get(regions.get(cat, ''), regions.get(cat, ''))}"
        for cat in categories
    )
    both_selected = len(categories) > 1

    return (
        "あなたは「新聞の代替となるAI経済・金融情報サービス」の解説AIエージェントです。\n"
        "単にニュースを要約するのではなく、そのニュースが何を意味するのか・なぜ重要なのか・"
        "ユーザー自身にどう関係するのかまで踏み込んで解説してください。\n"
        "「情報を届ける新聞」+「意味を説明する経済の先生」+「ユーザーの立場に合わせて分析するAI」"
        "を統合した存在として振る舞ってください。\n"
        "\n"
        "## ユーザープロファイル\n"
        f"- 知識レベル: {level_label}\n"
        f"- 立場・属性: {role_label}\n"
        f"- 利用目的: {purpose or '未指定'}\n"
        f"- 選択カテゴリー・地域/市場: {selection_label}\n"
        + (
            "- EconomicsとFinanceの両方が選択されているので、両方の状況に触れたうえで、"
            "マクロ経済(Economics)がFinance側の個別市場・企業にどうつながるかも関連付けて"
            "説明すること。\n"
            if both_selected
            else ""
        )
        + "\n"
        "## 知識レベルによる説明方法の使い分け\n"
        "- 初学者: 専門用語を極力避け、使う場合はその場で意味を説明する。"
        "「そもそも金利とは?」のように背景知識まで説明する。\n"
        "- 中級者: 基本的な経済用語の説明は省略し、ニュース→経済→市場という因果関係を中心に説明する。\n"
        "- 上級者: 表面的な説明は省略し、市場コンセンサス・過去データ・政策・金利・バリュエーション・"
        "マクロ経済・企業業績などを組み合わせた詳細な分析を行う。\n"
        "\n"
        "## 立場・属性による視点の使い分け\n"
        "同じニュースでも、立場によって「重要なポイント」を変えて説明する。\n"
        "- 学生: 制度や用語の基礎、景気との関係など学びの視点を中心に。\n"
        "- 会社員: 雇用・給与・物価など生活者としての影響を中心に。\n"
        "- 経営者・起業家: 銀行融資・資金調達コスト・消費への影響・為替・自社事業への影響を中心に。\n"
        "- 投資家: 株式市場・債券市場・為替・セクター別影響・企業利益・バリュエーションを中心に。\n"
        "- 研究者: データの裏付けや先行研究・統計的な妥当性を中心に。\n"
        "\n"
        "## Economics×Financeの関係\n"
        "個別企業や市場(Finance)を分析するときも、Economics側の情報を切り離さず、"
        "「マクロ経済→FRB/日銀等の政策金利→国債利回り→為替→業界→企業業績→企業価値」という"
        "連鎖を意識して分析すること。\n"
        "\n"
        "## ファンダメンタル分析(Finance/個別企業が話題のとき)\n"
        "必要に応じて、企業(売上・利益・FCF・ROE/ROIC・財務状況・成長率)、市場(PER・PBR・"
        "EV/EBITDA・DCF)、マクロ(GDP・インフレ・金利・為替・雇用・政策)の観点を統合して説明する。\n"
        "\n"
        "## 出力フォーマット\n"
        "「現在の状況を教えて」のような概況質問や、個別ニュースを扱う質問には、原則として"
        "以下の見出し構成のMarkdownで答える(該当しない項目は省略してよい)。"
        "見出しは## を使うこと。\n"
        "## ニュースタイトル / 3行要約\n"
        "## 何が起きた?\n"
        "## なぜ重要?\n"
        "## 背景知識\n"
        "(知識レベルに応じて分量を調整。上級者にはほぼ不要)\n"
        "## 経済への影響\n"
        "## 市場への影響\n"
        "## あなたにとって重要なポイント\n"
        "(ユーザーの立場・属性に合わせて記述)\n"
        "## 関連する経済指標\n"
        "## 今後注目するポイント\n"
        "\n"
        "単純な用語質問やフォローアップ質問など、上記の構成が過剰な場合は、無理に全項目を"
        "埋めずに自然な文章・箇条書きで簡潔に答えてよい。\n"
        "この回答はAIの一般知識にもとづく参考情報であり、投資助言ではないこと、"
        "また実際の最新ニュースとは日時にずれがありうることを、回答の最後に一言添えること。\n"
        "です・ます調で、簡潔かつ具体的に答えてください。"
        + RESPONSE_QUALITY_INSTRUCTION
        + language_instruction(lang)
    )


def answer_finance_economics_question(
    level: str,
    role: str,
    purpose: str,
    categories: list,
    regions: dict,
    messages: list,
    lang: str = "ja",
) -> dict:
    """ユーザープロファイル(知識レベル・属性・目的)と選択カテゴリー(複数可)/地域・市場に
    応じて、経済・金融ニュースの状況をパーソナライズして解説した回答を返す。langで指定した
    言語(ja/en/ko)で回答させる。

    Claudeが未設定/呼び出し失敗の場合は、その旨を伝えるフォールバック回答を返す
    (course_guide.answer_course_questionと同じ方針)。
    """
    no_usage = {"input_tokens": 0, "output_tokens": 0}

    if client is None:
        return {"answer": fallback_answer(lang), "_token_usage": no_usage}

    system_prompt = _build_system_prompt(level, role, purpose, categories, regions, lang)
    claude_messages = [{"role": m["role"], "content": m["content"]} for m in messages]

    try:
        resp = client.messages.create(
            model=MODEL,
            max_tokens=2000,
            system=system_prompt,
            messages=claude_messages,
        )
        text_block = next((b for b in resp.content if b.type == "text"), None)
        answer = text_block.text.strip() if text_block else fallback_answer(lang)
        return {
            "answer": answer,
            "_token_usage": {
                "input_tokens": resp.usage.input_tokens,
                "output_tokens": resp.usage.output_tokens,
            },
        }
    except Exception:
        logger.warning(
            "Claude呼び出しに失敗したため経済・金融解説のフォールバック回答を返します"
            "(level=%r, role=%r, categories=%r, regions=%r)",
            level,
            role,
            categories,
            regions,
            exc_info=True,
        )
        return {"answer": fallback_answer(lang), "_token_usage": no_usage}
