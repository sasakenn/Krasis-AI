from study_notes import generate_study_notes


def test_generate_study_notes_returns_expected_shape():
    result = generate_study_notes("江戸時代の身分制度についてのレポート本文がここに入ります。")

    assert set(["content", "_token_usage"]).issubset(result)
    assert result["content"]
    assert set(["input_tokens", "output_tokens"]).issubset(result["_token_usage"])
