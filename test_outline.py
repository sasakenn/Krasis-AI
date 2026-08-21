from outline import generate_outline


def test_generate_outline_returns_expected_shape():
    outline = generate_outline("生成AIが学術論文の執筆プロセスに与える影響", field="教育技術")

    assert set(["title", "research_question", "sections"]).issubset(outline)
    assert len(outline["sections"]) >= 5

    for section in outline["sections"]:
        assert set(["heading", "purpose", "search_query"]).issubset(section)
        assert section["heading"]
        assert section["purpose"]
        assert section["search_query"]
