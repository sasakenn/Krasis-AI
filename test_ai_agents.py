from ai_agents import answer_finance_economics_question


def test_answer_finance_economics_question_returns_expected_shape():
    result = answer_finance_economics_question(
        "beginner",
        "student",
        "毎日のニュース把握",
        ["economics"],
        {"economics": "japan"},
        [{"role": "user", "content": "現在の状況を教えて"}],
    )

    assert set(["answer", "_token_usage"]).issubset(result)
    assert result["answer"]
    assert set(["input_tokens", "output_tokens"]).issubset(result["_token_usage"])


def test_answer_finance_economics_question_supports_both_categories():
    result = answer_finance_economics_question(
        "advanced",
        "investor",
        "",
        ["economics", "finance"],
        {"economics": "us", "finance": "us-stocks"},
        [{"role": "user", "content": "現在の状況を教えて"}],
    )

    assert set(["answer", "_token_usage"]).issubset(result)
    assert result["answer"]
