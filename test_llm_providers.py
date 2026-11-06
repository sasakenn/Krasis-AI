from unittest.mock import MagicMock, patch

import llm_providers


def test_default_provider_is_anthropic(monkeypatch):
    monkeypatch.delenv("LLM_PROVIDER", raising=False)
    monkeypatch.delenv("ANTHROPIC_MODEL", raising=False)
    assert llm_providers.provider_name() == "anthropic"
    assert llm_providers.model_name() == "claude-sonnet-5"


def test_deepseek_selected_by_env_and_model_overridable(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "DeepSeek")
    monkeypatch.setenv("DEEPSEEK_MODEL", "deepseek-test-model")
    assert llm_providers.provider_name() == "deepseek"
    assert llm_providers.model_name() == "deepseek-test-model"


def test_build_client_returns_none_without_api_key(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "deepseek")
    monkeypatch.delenv("DEEPSEEK_API_KEY", raising=False)
    assert llm_providers.build_client() is None


def test_deepseek_client_matches_the_anthropic_response_shape(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "deepseek")
    monkeypatch.setenv("DEEPSEEK_API_KEY", "sk-test")
    client = llm_providers.build_client()
    fake = MagicMock()
    fake.json.return_value = {
        "choices": [{"message": {"content": "こんにちは"}}],
        "usage": {"prompt_tokens": 12, "completion_tokens": 34},
    }
    with patch.object(llm_providers.requests, "post", return_value=fake) as post:
        resp = client.messages.create(
            model="m",
            max_tokens=999999,
            system="システム",
            messages=[{"role": "user", "content": [{"type": "text", "text": "質問"}]}],
        )
    assert next(b for b in resp.content if b.type == "text").text == "こんにちは"
    assert (resp.usage.input_tokens, resp.usage.output_tokens) == (12, 34)
    body = post.call_args.kwargs["json"]
    assert body["messages"][0] == {"role": "system", "content": "システム"}
    assert body["messages"][1] == {"role": "user", "content": "質問"}
    assert body["max_tokens"] == llm_providers.DEFAULT_DEEPSEEK_MAX_OUTPUT_TOKENS  # 上限に切り詰める
    assert post.call_args.kwargs["headers"]["Authorization"] == "Bearer sk-test"
    assert post.call_args.args[0] == "https://api.deepseek.com/chat/completions"
