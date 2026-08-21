import json
import os
import re

from anthropic import Anthropic
from dotenv import load_dotenv

load_dotenv()

ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY")
MODEL = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-5")
client = Anthropic(api_key=ANTHROPIC_API_KEY) if ANTHROPIC_API_KEY else None


def _clean_topic(topic: str) -> str:
    return re.sub(r"\s+", " ", topic.strip())


def _guess_title(topic: str) -> str:
    clean = _clean_topic(topic)
    if not clean:
        return "学術調査の構造化計画"
    return f"{clean}に関する調査計画"


def _keywordize(topic: str) -> str:
    clean = _clean_topic(topic)
    if not clean:
        return "research design and evidence synthesis"

    # 日本語の文を、英語検索に使いやすい形に変換して簡略化する
    converted = clean.replace("生成AI", "generative AI")
    converted = converted.replace("AI", "AI")
    converted = converted.replace("大学", "university")
    converted = converted.replace("論文", "academic paper")
    converted = converted.replace("レポート", "report")
    converted = converted.replace("教育", "education")
    converted = converted.replace("技術", "technology")
    converted = converted.replace("影響", "impact")
    converted = converted.replace("分析", "analysis")
    converted = converted.replace("評価", "evaluation")
    converted = converted.replace("研究", "research")
    converted = converted.replace("プロセス", "process")
    converted = converted.replace("方法", "method")
    converted = re.sub(r"\s+", " ", converted)
    return converted


def _fallback_outline(topic: str, field: str = "一般") -> dict:
    clean_topic = _clean_topic(topic)
    section_base = _keywordize(clean_topic)
    s1 = section_base
    s2 = f"{section_base} literature review"
    s3 = f"{section_base} research framework"
    s4 = f"{section_base} evaluation methods"
    s5 = f"{section_base} limitations and critique"

    return {
        "title": _guess_title(clean_topic),
        "research_question": f"{clean_topic if clean_topic else 'このテーマ'}において、主要な論点・背景・根拠は何か、どのように整理すべきか？",
        "sections": [
            {
                "heading": "問題設定と背景",
                "purpose": "テーマの重要性、対象領域、既存の議論の前提を整理し、調査の軸を明確にする。",
                "search_query": s1
            },
            {
                "heading": "既存研究の整理",
                "purpose": "関連する先行研究や実証事例を概観し、どの観点が重視されているかを把握する。",
                "search_query": s2
            },
            {
                "heading": "分析の枠組み",
                "purpose": "テーマを整理するための概念、要因、因果関係の見立てを示し、論点を具体化する。",
                "search_query": s3
            },
            {
                "heading": "比較と検証",
                "purpose": "複数の視点や事例を比較し、対象の特徴や差異、妥当性を検討する。",
                "search_query": f"{section_base} comparison evaluation"
            },
            {
                "heading": "課題と反論の検討",
                "purpose": "限界、批判可能性、異論の余地を整理し、対話的に議論の妥当性を高める。",
                "search_query": s5
            },
            {
                "heading": "結論と今後の方向性",
                "purpose": "整理した知見をまとめ、今後の論点や調査の方向性を示す。",
                "search_query": f"{section_base} future research directions"
            }
        ]
    }


def _build_safe_prompt(
    topic: str,
    field: str,
    reference_notes: str = "",
    format_notes: str = "",
    target_length: str = "",
) -> str:
    reference_block = f"\n\n参考資料(ユーザーがアップロードした関連資料の抜粋):\n{reference_notes}\n" if reference_notes.strip() else ""
    format_block = f"\n\n論文フォーマット指定(ユーザーがアップロードした指定内容):\n{format_notes}\n" if format_notes.strip() else ""
    length_block = (
        f"\n\n想定分量: 最終的な論文本文で{target_length.replace('-', '〜')}文字程度になることを想定し、"
        "節の数や各purposeの詳しさをその分量に見合う粒度に調整すること。\n"
        if target_length.strip()
        else ""
    )

    return f"""あなたは{field}分野の調査計画作成支援を行う研究支援アシスタントです。

以下のテーマについて、大学レポートの完成文を作るのではなく、学術的な調査計画として使える構成案だけを作成してください。

テーマ: {topic}
{reference_block}{format_block}{length_block}
要件:
- 日本語で出力する
- JSONのみを返す
- 前後に説明文やコードブロック記号は付けない
- 6つの節で構成し、背景・既存研究・分析枠組み・比較検証・反論の検討・結論を含める
- 各節は以下のキーを持つ: heading, purpose, search_query
- search_queryは英語の文献検索キーワードにし、3〜6語程度で具体的にする
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
      "search_query": "英語検索キーワード"
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
) -> dict:
    """安全な文脈でアウトラインを返す。

    - Claude の利用が規制や認証エラーで失敗した場合でも、ローカルのフォールバックを返す。
    - 完成したレポート本文を出力する。
    - reference_notes / format_notes は、ユーザーがアップロードした資料の抜粋・
      フォーマット指定を Claude のプロンプトに反映するために使う(任意)。
    - target_length は「1-100」のような文字数レンジ(任意)で、出力の粒度の目安に使う。
    """
    normalized_topic = _clean_topic(topic)

    if client is not None:
        try:
            prompt = _build_safe_prompt(normalized_topic, field, reference_notes, format_notes, target_length)
            resp = client.messages.create(
                model=MODEL,
                max_tokens=2000,
                messages=[{"role": "user", "content": prompt}],
            )
            return _parse_model_response(resp.content[0].text)
        except Exception:
            return _fallback_outline(normalized_topic, field)

    return _fallback_outline(normalized_topic, field)


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
