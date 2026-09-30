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
