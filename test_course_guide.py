from course_guide import answer_course_question


def test_answer_course_question_returns_expected_shape():
    result = answer_course_question(
        "同志社大学",
        "文学部",
        "",
        [{"role": "user", "content": "民法の授業は何を勉強しますか?"}],
    )

    assert set(["answer", "_token_usage"]).issubset(result)
    assert result["answer"]
    assert set(["input_tokens", "output_tokens"]).issubset(result["_token_usage"])
