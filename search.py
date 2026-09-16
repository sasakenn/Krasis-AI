"""
search.py
---------
OpenAlex(https://openalex.org)というAPIを使って、与えられたキーワードに
関連する学術文献を検索するモジュール。

OpenAlex は全分野を横断する無料の学術文献データベースで、APIキーは不要。
ただし「polite pool」という優先レーン(応答が速く、レート制限も緩い)を
使うために、リクエストに自分のメールアドレスを添えるのがマナーとされている。
(付けなくても動作するが、混雑時に弾かれやすくなる)
"""

from __future__ import annotations

import os

import requests
from dotenv import load_dotenv

load_dotenv()

# OpenAlex の API エンドポイント。"works" は論文・書籍などの文献を指す。
OPENALEX_API_URL = "https://api.openalex.org/works"

# polite pool 用のメールアドレス。.env に OPENALEX_MAILTO を設定すればそれを使う。
# 未設定でも動作する(必須ではない)。
MAILTO = os.getenv("OPENALEX_MAILTO", "")


def _restore_abstract(inverted_index: dict | None) -> str:
    """
    OpenAlex の抄録(abstract)は著作権上の理由から、そのままの文章ではなく
    「単語ごとの出現位置」という形式(abstract_inverted_index)で返ってくる。
    例: {"The": [0], "cat": [1, 4], "sat": [2], ...}

    これを本来の文章(スペース区切りのテキスト)に組み立て直す。
    抄録が存在しない文献では inverted_index が None になる。
    """
    if not inverted_index:
        return ""

    # 出現位置の最大値から文章全体の長さ(単語数)を決め、空リストを用意する
    max_position = max(pos for positions in inverted_index.values() for pos in positions)
    words = [""] * (max_position + 1)

    for word, positions in inverted_index.items():
        for pos in positions:
            words[pos] = word

    return " ".join(words)


def search_literature(query: str, limit: int = 5, language: str | None = None) -> list[dict]:
    """
    OpenAlex で文献を検索し、関連度の高い順に上位 `limit` 件を返す。

    引数:
        query: 検索キーワード(英語推奨。例: "large language model reasoning")
        limit: 取得する文献数(デフォルト5件)
        language: 指定すると、その言語(ISO 639-1、例: "ja")で書かれた文献に絞り込む。
            Noneなら言語を問わず検索する。

    戻り値:
        以下のキーを持つ辞書のリスト。
        - title:    タイトル
        - authors:  著者名のリスト
        - year:     出版年
        - doi:      DOI(取得できない場合は None)
        - abstract: 抄録(復元済みのテキスト。取得できない場合は空文字列)
        - url:      OpenAlex 上の文献ページのURL(引用実在チェックにも使える)
        - language: 文献の言語コード(取得できない場合は None)
    """
    params = {
        "search": query,
        "per-page": limit,
    }
    if language:
        params["filter"] = f"language:{language}"
    if MAILTO:
        params["mailto"] = MAILTO

    response = requests.get(OPENALEX_API_URL, params=params, timeout=15)
    response.raise_for_status()  # 4xx/5xx が返ってきたら例外を発生させる

    results = response.json().get("results", [])

    literature = []
    for work in results:
        authors = [
            authorship["author"]["display_name"]
            for authorship in work.get("authorships", [])
            if authorship.get("author")
        ]
        literature.append({
            "title": work.get("display_name") or "(タイトル不明)",
            "authors": authors,
            "year": work.get("publication_year"),
            "doi": work.get("doi"),
            "abstract": _restore_abstract(work.get("abstract_inverted_index")),
            "url": work.get("id", ""),
            "language": work.get("language"),
        })

    return literature


def search_literature_diverse(
    query_international: str,
    query_native: str = "",
    limit: int = 5,
    native_language: str = "ja",
) -> list[dict]:
    """
    国際的な(主に英語の)文献と、テーマの言語圏で発行された文献の両方を検索し、
    発行元の国・言語をなるべく偏らせずに `limit` 件にまとめて返す。

    query_nativeが空、またはnative_language分の検索が失敗した場合は、
    query_internationalの結果だけで埋める(呼び出し元に影響を出さないため)。
    重複(DOIまたはURLが一致)は除いて、国際版→国内版の順に交互で採用する。
    """
    native_limit = limit // 2 if query_native.strip() else 0
    international_limit = limit - native_limit

    international = search_literature(query_international, limit=international_limit)

    native = []
    if native_limit > 0:
        try:
            native = search_literature(query_native, limit=native_limit, language=native_language)
        except Exception:
            native = []

    seen_keys = set()
    merged = []
    for paper in native + international:
        key = paper.get("doi") or paper.get("url")
        if key and key in seen_keys:
            continue
        if key:
            seen_keys.add(key)
        merged.append(paper)

    if len(merged) < limit:
        shortfall = limit - len(merged)
        backfill = search_literature(query_international, limit=international_limit + shortfall)
        for paper in backfill:
            if len(merged) >= limit:
                break
            key = paper.get("doi") or paper.get("url")
            if key and key in seen_keys:
                continue
            if key:
                seen_keys.add(key)
            merged.append(paper)

    return merged[:limit]


# --- 動作確認用(このファイルを直接実行したときだけ動く) ---
if __name__ == "__main__":
    sample_query = "large language model reasoning"
    print(f"検索クエリ: {sample_query}\n")

    papers = search_literature(sample_query, limit=3)
    for i, paper in enumerate(papers, start=1):
        print(f"[{i}] {paper['title']} ({paper['year']})")
        print(f"    著者: {', '.join(paper['authors']) if paper['authors'] else '不明'}")
        print(f"    DOI: {paper['doi']}")
        abstract_preview = paper["abstract"][:150]
        suffix = "..." if len(paper["abstract"]) > 150 else ""
        print(f"    抄録: {abstract_preview}{suffix}")
        print()
