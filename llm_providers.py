"""AI(LLM)の呼び出し先を切り替えるための、共通の入口。

各機能(outline.py等)は、Anthropicのクライアントと同じ形(client.messages.create(...)で
resp.content[i].text / resp.usage.input_tokens を読む)で呼んでいる。DeepSeekを使う場合も、
その形のままで呼べるアダプタ(DeepSeekClient)を返すことで、各機能のコードを書き換えずに
切り替える。

切り替えは環境変数で行う(未設定なら従来どおりAnthropic):
- LLM_PROVIDER=anthropic(既定) | deepseek
- anthropic: ANTHROPIC_API_KEY、ANTHROPIC_MODEL(既定 claude-sonnet-5)
- deepseek : DEEPSEEK_API_KEY、DEEPSEEK_MODEL、DEEPSEEK_BASE_URL(既定 https://api.deepseek.com)

DeepSeekを使うと、利用者の入力内容がDeepSeekのサーバーに送られる。プライバシーポリシーの
外部サービス一覧への記載と、利用者への説明が必要になる(PRIVACY.md参照)。
"""
import logging
import os
from types import SimpleNamespace

import requests

logger = logging.getLogger(__name__)

DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-5"
# DeepSeekのモデル名は更新が早い。公式ドキュメント(https://api-docs.deepseek.com/)で確認し、
# 実際に使う名前を環境変数DEEPSEEK_MODELで指定すること。
DEFAULT_DEEPSEEK_MODEL = "deepseek-flash"
DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com"
# 出力トークンの上限(モデルごとの上限を超えるとAPIがエラーを返すため、超える指定は切り詰める)
DEFAULT_DEEPSEEK_MAX_OUTPUT_TOKENS = 8000
DEEPSEEK_TIMEOUT_SECONDS = 120


def provider_name() -> str:
    return os.getenv("LLM_PROVIDER", "anthropic").strip().lower() or "anthropic"


def model_name() -> str:
    if provider_name() == "deepseek":
        return os.getenv("DEEPSEEK_MODEL", DEFAULT_DEEPSEEK_MODEL).strip() or DEFAULT_DEEPSEEK_MODEL
    return os.getenv("ANTHROPIC_MODEL", DEFAULT_ANTHROPIC_MODEL)


def _flatten_content(content) -> str:
    """messagesのcontent(文字列、またはAnthropic形式のブロックのリスト)を、1つの文字列にする。"""
    if isinstance(content, str):
        return content
    parts = []
    for block in content or []:
        if isinstance(block, dict):
            if block.get("type", "text") == "text":
                parts.append(str(block.get("text", "")))
        else:
            parts.append(str(getattr(block, "text", "")))
    return "\n".join(part for part in parts if part)


class _DeepSeekMessages:
    def __init__(self, api_key: str, base_url: str):
        self._api_key = api_key
        self._base_url = base_url.rstrip("/")

    def create(self, *, model, max_tokens, messages, system=None, **_ignored):
        chat_messages = []
        if system:
            chat_messages.append({"role": "system", "content": _flatten_content(system)})
        for message in messages:
            chat_messages.append({"role": message["role"], "content": _flatten_content(message["content"])})

        limit = int(os.getenv("DEEPSEEK_MAX_OUTPUT_TOKENS", DEFAULT_DEEPSEEK_MAX_OUTPUT_TOKENS))
        resp = requests.post(
            f"{self._base_url}/chat/completions",
            headers={"Authorization": f"Bearer {self._api_key}", "Content-Type": "application/json"},
            json={"model": model, "messages": chat_messages, "max_tokens": min(int(max_tokens), limit), "stream": False},
            timeout=DEEPSEEK_TIMEOUT_SECONDS,
        )
        resp.raise_for_status()
        data = resp.json()
        text = (data.get("choices") or [{}])[0].get("message", {}).get("content") or ""
        usage = data.get("usage") or {}
        return SimpleNamespace(
            content=[SimpleNamespace(type="text", text=text)],
            usage=SimpleNamespace(
                input_tokens=int(usage.get("prompt_tokens", 0)),
                output_tokens=int(usage.get("completion_tokens", 0)),
            ),
        )


class DeepSeekClient:
    """Anthropicのクライアントと同じ client.messages.create(...) の形で、DeepSeekを呼ぶアダプタ。"""

    def __init__(self, api_key: str, base_url: str = DEFAULT_DEEPSEEK_BASE_URL):
        self.messages = _DeepSeekMessages(api_key, base_url)


def build_client():
    """LLM_PROVIDERに応じたクライアントを返す。APIキー未設定ならNone(各機能がフォールバックする)。"""
    if provider_name() == "deepseek":
        api_key = os.getenv("DEEPSEEK_API_KEY", "").strip()
        # 原因の切り分け用に、使う提供元・モデルと、キーが設定されているか(値は出さない)をログに残す
        logger.info("LLM provider=deepseek model=%s key_set=%s", model_name(), bool(api_key))
        if not api_key:
            return None
        return DeepSeekClient(api_key, os.getenv("DEEPSEEK_BASE_URL", DEFAULT_DEEPSEEK_BASE_URL))

    api_key = os.getenv("ANTHROPIC_API_KEY", "").strip()
    logger.info("LLM provider=anthropic model=%s key_set=%s", model_name(), bool(api_key))
    if not api_key:
        return None
    from anthropic import Anthropic

    return Anthropic(api_key=api_key)
