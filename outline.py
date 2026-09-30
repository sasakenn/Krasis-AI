import json
import logging
import os
import re

from anthropic import Anthropic
from dotenv import load_dotenv

from lang_utils import normalize_lang

load_dotenv()

logger = logging.getLogger(__name__)

ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY")
MODEL = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-5")
client = Anthropic(api_key=ANTHROPIC_API_KEY) if ANTHROPIC_API_KEY else None

# フォールバック(Claude未使用時)の検索クエリ生成に使う日英対応表。
_JA_EN_TERMS = {
    "生成AI": "generative AI",
    "大学": "university",
    "論文": "academic paper",
    "レポート": "report",
    "教育": "education",
    "技術": "technology",
    "影響": "impact",
    "分析": "analysis",
    "評価": "evaluation",
    "研究": "research",
    "プロセス": "process",
    "方法": "method",
}

_JAPANESE_CHAR_RE = re.compile(r"[぀-んァ-ヶ一-龯]")


def _clean_topic(topic: str) -> str:
    return re.sub(r"\s+", " ", topic.strip())


_GUESS_TITLE_TEMPLATES = {
    "ja": {"empty": "学術調査の構造化計画", "withTopic": "{topic}に関する調査計画"},
    "en": {"empty": "Structured academic research plan", "withTopic": "Research plan on {topic}"},
    "ko": {"empty": "학술 조사 구조화 계획", "withTopic": "{topic}에 관한 조사 계획"},
}


def _guess_title(topic: str, lang: str = "ja") -> str:
    clean = _clean_topic(topic)
    tpl = _GUESS_TITLE_TEMPLATES[normalize_lang(lang)]
    if not clean:
        return tpl["empty"]
    return tpl["withTopic"].format(topic=clean)


def _keywordize(topic: str, field: str = "") -> str:
    """Claudeが使えない場合のフォールバック用に、日本語の題目を英語検索クエリへ変換する。

    対応表(_JA_EN_TERMS)にない単語は変換できず日本語のまま残るため、変換後も
    日本語が残っている場合はOpenAlexに投げてもノイズになるだけなので、
    分野名(こちらも変換できた場合のみ)を使った汎用クエリにフォールバックする。
    """
    clean = _clean_topic(topic)
    if not clean:
        return "research design and evidence synthesis"

    converted = clean
    for ja, en in _JA_EN_TERMS.items():
        converted = converted.replace(ja, en)
    converted = re.sub(r"\s+", " ", converted).strip()

    if _JAPANESE_CHAR_RE.search(converted):
        field_converted = _JA_EN_TERMS.get(field.strip(), field.strip())
        if field_converted and not _JAPANESE_CHAR_RE.search(field_converted):
            return f"{field_converted} research trends"
        return "research design and evidence synthesis"

    return converted


_FALLBACK_OUTLINE_TEXT = {
    "ja": {
        "research_question": "{topic}において、主要な論点・背景・根拠は何か、どのように整理すべきか？",
        "empty_topic": "このテーマ",
        "sections": [
            ("問題設定と背景", "テーマの重要性、対象領域、既存の議論の前提を整理し、調査の軸を明確にする。", "背景"),
            ("既存研究の整理", "関連する先行研究や実証事例を概観し、どの観点が重視されているかを把握する。", "先行研究"),
            ("分析の枠組み", "テーマを整理するための概念、要因、因果関係の見立てを示し、論点を具体化する。", "分析枠組み"),
            ("比較と検証", "複数の視点や事例を比較し、対象の特徴や差異、妥当性を検討する。", "比較"),
            ("課題と反論の検討", "限界、批判可能性、異論の余地を整理し、対話的に議論の妥当性を高める。", "課題"),
            ("結論と今後の方向性", "整理した知見をまとめ、今後の論点や調査の方向性を示す。", "今後の展望"),
        ],
    },
    "en": {
        "research_question": "What are the key issues, background, and evidence around {topic}, and how should they be organized?",
        "empty_topic": "this topic",
        "sections": [
            ("Problem framing and background", "Organize the significance of the topic, its scope, and the premises of existing discussion to clarify the axis of inquiry.", "background"),
            ("Review of existing research", "Survey related prior research and empirical cases to understand which perspectives are emphasized.", "prior research"),
            ("Analytical framework", "Present the concepts, factors, and hypothesized causal relationships used to organize the topic.", "analytical framework"),
            ("Comparison and verification", "Compare multiple viewpoints or cases to examine the subject's characteristics, differences, and validity.", "comparison"),
            ("Limitations and counterarguments", "Organize the limitations, possible criticisms, and room for disagreement to strengthen the argument dialogically.", "limitations"),
            ("Conclusion and future directions", "Summarize the findings and indicate future issues and directions for inquiry.", "future outlook"),
        ],
    },
    "ko": {
        "research_question": "{topic}에서 주요 쟁점·배경·근거는 무엇이며, 이를 어떻게 정리해야 하는가?",
        "empty_topic": "이 주제",
        "sections": [
            ("문제 설정과 배경", "주제의 중요성, 대상 영역, 기존 논의의 전제를 정리하여 조사의 축을 명확히 한다.", "배경"),
            ("기존 연구 정리", "관련 선행 연구와 실증 사례를 개관하여 어떤 관점이 중시되는지 파악한다.", "선행 연구"),
            ("분석 틀", "주제를 정리하기 위한 개념, 요인, 인과관계에 대한 가설을 제시하여 논점을 구체화한다.", "분석 틀"),
            ("비교와 검증", "여러 관점이나 사례를 비교하여 대상의 특징, 차이, 타당성을 검토한다.", "비교"),
            ("과제와 반론 검토", "한계, 비판 가능성, 이견의 여지를 정리하여 논의의 타당성을 대화적으로 높인다.", "과제"),
            ("결론과 향후 방향", "정리한 지식을 요약하고 향후 논점과 조사 방향을 제시한다.", "향후 전망"),
        ],
    },
}


def _fallback_outline(topic: str, field: str = "一般", lang: str = "ja") -> dict:
    lang = normalize_lang(lang)
    clean_topic = _clean_topic(topic)
    section_base = _keywordize(clean_topic, field)
    text = _FALLBACK_OUTLINE_TEXT[lang]
    native_base = clean_topic if clean_topic else text["empty_topic"]

    search_queries = [
        section_base,
        f"{section_base} literature review",
        f"{section_base} research framework",
        f"{section_base} comparison evaluation",
        f"{section_base} limitations and critique",
        f"{section_base} future research directions",
    ]

    return {
        "title": _guess_title(clean_topic, lang),
        "research_question": text["research_question"].format(topic=clean_topic or text["empty_topic"]),
        "sections": [
            {
                "heading": heading,
                "purpose": purpose,
                "search_query": search_queries[i],
                "search_query_native": f"{native_base} {native_suffix}",
            }
            for i, (heading, purpose, native_suffix) in enumerate(text["sections"])
        ],
    }


_OUTPUT_LANGUAGE_REQUIREMENT = {
    "ja": "- 日本語で出力する",
    "en": "- Output in English",
    "ko": "- 한국어로 출력할 것",
}


def _build_safe_prompt(
    topic: str,
    field: str,
    reference_notes: str = "",
    format_notes: str = "",
    target_length: str = "",
    lang: str = "ja",
) -> str:
    reference_block = f"\n\n参考資料(ユーザーがアップロードした関連資料の抜粋):\n{reference_notes}\n" if reference_notes.strip() else ""
    format_block = f"\n\n論文フォーマット指定(ユーザーがアップロードした指定内容):\n{format_notes}\n" if format_notes.strip() else ""
    length_block = (
        f"\n\n想定分量: 最終的な論文本文で{target_length.replace('-', '〜')}文字程度になることを想定し、"
        "節の数や各purposeの詳しさをその分量に見合う粒度に調整すること。\n"
        if target_length.strip()
        else ""
    )
    language_requirement = _OUTPUT_LANGUAGE_REQUIREMENT[normalize_lang(lang)]

    return f"""あなたは{field}分野の調査計画作成支援を行う研究支援アシスタントです。

以下のテーマについて、大学レポートの完成文を作るのではなく、学術的な調査計画として使える構成案だけを作成してください。

テーマ: {topic}
{reference_block}{format_block}{length_block}
要件:
{language_requirement}
- JSONのみを返す
- 前後に説明文やコードブロック記号は付けない
- 6つの節で構成し、背景・既存研究・分析枠組み・比較検証・反論の検討・結論を含める
- 各節は以下のキーを持つ: heading, purpose, search_query, search_query_native
- search_queryは英語の文献検索キーワードにし、3〜6語程度で具体的にする(国際的な文献を探すため)
- search_query_nativeはテーマの言語(日本語)の文献検索キーワードにし、2〜5語程度で具体的にする
  (国内で発行された文献も引用に含めるため。英語への機械的な逐語訳ではなく、その言語圏で
  実際に使われる学術用語を使うこと)
- 参考資料が提示されている場合は、その内容と矛盾しない構成にする
- 論文フォーマット指定が提示されている場合は、その指定(節構成・分量など)を優先する

出力形式:
{{
  "title": "研究計画のタイトル",
  "research_question": "調査の中心的な問い",
  "sections": [
    {{
      "heading": "節の見出し",
      "purpose": "この節で扱う内容（1〜2文）",
      "search_query": "英語検索キーワード",
      "search_query_native": "日本語検索キーワード"
    }}
  ]
}}"""


def _parse_model_response(raw_text: str) -> dict:
    text = raw_text.strip()
    if text.startswith("```"):
        text = text.split("```", 2)[1].replace("json", "", 1).strip() if "```" in text else text
    return json.loads(text)


def generate_outline(
    topic: str,
    field: str = "一般",
    reference_notes: str = "",
    format_notes: str = "",
    target_length: str = "",
    lang: str = "ja",
) -> dict:
    """安全な文脈でアウトラインを返す。langで指定した言語(ja/en/ko)で出力させる。

    - Claude の利用が規制や認証エラーで失敗した場合でも、ローカルのフォールバックを返す。
    - 完成したレポート本文を出力する。
    - reference_notes / format_notes は、ユーザーがアップロードした資料の抜粋・
      フォーマット指定を Claude のプロンプトに反映するために使う(任意)。
    - target_length は「1-100」のような文字数レンジ(任意)で、出力の粒度の目安に使う。
    """
    normalized_topic = _clean_topic(topic)
    lang = normalize_lang(lang)

    if client is not None:
        try:
            prompt = _build_safe_prompt(normalized_topic, field, reference_notes, format_notes, target_length, lang)
            resp = client.messages.create(
                model=MODEL,
                max_tokens=2000,
                messages=[{"role": "user", "content": prompt}],
            )
            text_block = next(block for block in resp.content if block.type == "text")
            outline = _parse_model_response(text_block.text)
            # 呼び出し元(app.py)がトークン利用量を課金/クォータ管理に使うための内部情報。
            # クライアントへのレスポンスに含める前にpopして取り除く。
            outline["_token_usage"] = {
                "input_tokens": resp.usage.input_tokens,
                "output_tokens": resp.usage.output_tokens,
            }
            return outline
        except Exception:
            logger.warning(
                "Claude呼び出しに失敗したためフォールバックのアウトラインを返します(topic=%r, field=%r)",
                normalized_topic,
                field,
                exc_info=True,
            )
            return _fallback_outline(normalized_topic, field, lang)

    return _fallback_outline(normalized_topic, field, lang)


# --- 動作確認用(このファイルを直接実行したときだけ動く) ---
if __name__ == "__main__":
    sample_topic = "生成AIが学術論文の執筆プロセスに与える影響"
    print(f"お題: {sample_topic}\n")

    outline = generate_outline(sample_topic, field="教育技術")

    print(f"タイトル: {outline['title']}")
    print(f"中心の問い: {outline['research_question']}\n")

    for i, section in enumerate(outline["sections"], start=1):
        print(f"[{i}] {section['heading']}")
        print(f"    目的: {section['purpose']}")
        print(f"    検索キーワード: {section['search_query']}")
        print()

    print("--- JSON全体 ---")
    print(json.dumps(outline, ensure_ascii=False, indent=2))
