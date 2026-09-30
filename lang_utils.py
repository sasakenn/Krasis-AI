"""
lang_utils.py
-------------
フロントエンド(frontend/src/i18n.jsx)で管理している3言語(ja/en/ko)の切り替えを、
Claudeへの指示・フォールバック文言でも一貫させるための共通ヘルパー。
"""

from __future__ import annotations

SUPPORTED_LANGUAGES = ("ja", "en", "ko")
DEFAULT_LANGUAGE = "ja"

LANGUAGE_NAMES = {
    "ja": "日本語",
    "en": "English",
    "ko": "한국어",
}


def normalize_lang(lang: str | None) -> str:
    return lang if lang in SUPPORTED_LANGUAGES else DEFAULT_LANGUAGE


def language_instruction(lang: str) -> str:
    """システムプロンプトの末尾に追加する、回答言語を指定する一文。"""
    name = LANGUAGE_NAMES[normalize_lang(lang)]
    return f"\n\n## 回答言語\n見出し・本文を含め、必ず{name}で回答してください。"


# course_guide(授業案内チャット)・ai_agents(経済・金融チャット)のような、ユーザーと
# 対話するAI機能の応答品質を底上げするための共通指示。回答言語(language_instruction)とは
# 独立に、どの言語で答える場合でも同じ基準を適用する。
RESPONSE_QUALITY_INSTRUCTION = """

## 応答品質の基準
正確さとユーザーの意図を優先しながら、自然で明快な文章で答えてください。

【表現の基準】
- 最初に、ユーザーが最も知りたいことへ直接答える。
- 一つの文には、できるだけ一つの要点を置く。
- 抽象的な表現より、具体的な言葉や例を使う。
- 不要な前置き、同じ内容の繰り返し、過剰な称賛、定型的な締めを省く。
- 専門用語は必要な場合だけ使い、相手の理解度に合わせて説明する。
- 親しみやすさと礼儀を保ち、過度に堅くも馴れ馴れしくもしない。
- 見出しや箇条書きは、文章だけより理解しやすくなる場合に使う。
- 短い質問には簡潔に、複雑な相談には必要な背景や根拠まで答える。
- 事実、推測、提案を区別する。表現を美しくするために、根拠のない内容を足したり、必要な注意点を削ったりしない。

【回答前の改善】
回答を送る前に、次の観点で下書きを内部的に確認し、必要な箇所だけ修正する。
1. 質問に直接答えているか。
2. 一読して意味が伝わるか。
3. 削っても意味が変わらない文や語句はないか。
4. 説明不足や、不自然につながる箇所はないか。
5. 相手の目的と口調に合っているか。

評価や推敲の過程は表示せず、改善後の回答だけを提示する。

【フィードバックの反映】
ユーザーが表現を修正したり、好みを伝えたりしたら、その意図を以後の回答に反映する。ただし、一度限りの依頼を恒久的な好みと決めつけない。明示された好みを優先し、反応がないことを高評価と解釈しない。

改善の目的は、文章を長くしたり華やかにしたりすることではなく、より少ない負担で、正確に理解できる対話にすることである。"""


FALLBACK_ANSWERS = {
    "ja": "現在この機能を利用できません(APIキー未設定、または一時的なエラーです)。しばらく待ってから再試行してください。",
    "en": "This feature is currently unavailable (missing API key or a temporary error). Please try again later.",
    "ko": "현재 이 기능을 사용할 수 없습니다(API 키 미설정 또는 일시적인 오류입니다). 잠시 후 다시 시도해 주세요.",
}


def fallback_answer(lang: str) -> str:
    return FALLBACK_ANSWERS[normalize_lang(lang)]


DEFAULT_QUESTIONS = {
    "ja": "現在の状況を教えて",
    "en": "Tell me about the current situation",
    "ko": "현재 상황을 알려줘",
}


def default_question(lang: str) -> str:
    return DEFAULT_QUESTIONS[normalize_lang(lang)]


AI_AGENTS_EMAIL_SUBJECTS = {
    "ja": "【AI Agents】本日の経済・金融ニュース",
    "en": "[AI Agents] Today's economy & finance news",
    "ko": "[AI Agents] 오늘의 경제·금융 뉴스",
}


def ai_agents_email_subject(lang: str) -> str:
    return AI_AGENTS_EMAIL_SUBJECTS[normalize_lang(lang)]
