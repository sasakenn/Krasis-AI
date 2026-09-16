from unittest.mock import patch

from search import search_literature_diverse


def _paper(key, language=None):
    return {
        "title": f"Paper {key}",
        "authors": ["Someone"],
        "year": 2024,
        "doi": f"10.1234/{key}",
        "abstract": "",
        "url": f"https://openalex.org/{key}",
        "language": language,
    }


def test_search_literature_diverse_mixes_native_and_international_results():
    international_results = [_paper("intl-1", "en"), _paper("intl-2", "en")]
    native_results = [_paper("native-1", "ja"), _paper("native-2", "ja")]

    def _fake_search(query, limit=5, language=None):
        return native_results[:limit] if language else international_results[:limit]

    with patch("search.search_literature", side_effect=_fake_search):
        results = search_literature_diverse("intl query", "native query", limit=4)

    languages = {paper["language"] for paper in results}
    assert len(results) == 4
    assert "ja" in languages
    assert "en" in languages


def test_search_literature_diverse_deduplicates_by_doi():
    shared = _paper("shared", "en")
    international_results = [shared, _paper("intl-2", "en")]
    native_results = [shared, _paper("native-2", "ja")]

    def _fake_search(query, limit=5, language=None):
        return native_results[:limit] if language else international_results[:limit]

    with patch("search.search_literature", side_effect=_fake_search):
        results = search_literature_diverse("intl query", "native query", limit=4)

    dois = [paper["doi"] for paper in results]
    assert len(dois) == len(set(dois))


def test_search_literature_diverse_backfills_from_international_when_native_empty():
    international_results = [_paper(f"intl-{i}", "en") for i in range(5)]

    def _fake_search(query, limit=5, language=None):
        if language:
            return []
        return international_results[:limit]

    with patch("search.search_literature", side_effect=_fake_search):
        results = search_literature_diverse("intl query", "native query", limit=4)

    assert len(results) == 4


def test_search_literature_diverse_without_native_query_uses_international_only():
    international_results = [_paper(f"intl-{i}", "en") for i in range(5)]

    def _fake_search(query, limit=5, language=None):
        assert language is None
        return international_results[:limit]

    with patch("search.search_literature", side_effect=_fake_search):
        results = search_literature_diverse("intl query", "", limit=3)

    assert len(results) == 3
