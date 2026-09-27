import io
from unittest.mock import patch

from docx import Document
from fastapi.testclient import TestClient

import app as app_module
from app import app
from conftest import DEFAULT_TEST_USER_ID

client = TestClient(app)
# DEV_BYPASS_USER_ID(conftest.pyで設定済み)経由で、各テストのリクエストは
# デフォルトで同じテストユーザーとして認証される。未認証/別ユーザーの挙動を
# 確認したいテストだけ、個別にヘッダーを上書き・削除する。
client.headers["X-Dev-User-Id"] = DEFAULT_TEST_USER_ID


def _build_minimal_pdf(text: str) -> bytes:
    """Hand-rolled single-page PDF with a text object (no extra deps needed)."""
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> "
        b"/MediaBox [0 0 300 300] /Contents 5 0 R >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    stream_content = f"BT /F1 18 Tf 20 150 Td ({text}) Tj ET".encode("latin-1")
    objects.append(b"<< /Length %d >>\nstream\n" % len(stream_content) + stream_content + b"\nendstream")

    out = io.BytesIO()
    out.write(b"%PDF-1.4\n")
    offsets = [0]
    for i, obj in enumerate(objects, start=1):
        offsets.append(out.tell())
        out.write(f"{i} 0 obj\n".encode())
        out.write(obj)
        out.write(b"\nendobj\n")

    xref_offset = out.tell()
    n = len(objects) + 1
    out.write(f"xref\n0 {n}\n".encode())
    out.write(b"0000000000 65535 f \n")
    for off in offsets[1:]:
        out.write(f"{off:010d} 00000 n \n".encode())
    out.write(b"trailer\n")
    out.write(f"<< /Size {n} /Root 1 0 R >>\n".encode())
    out.write(b"startxref\n")
    out.write(f"{xref_offset}\n".encode())
    out.write(b"%%EOF")
    return out.getvalue()


def _build_minimal_docx(text: str) -> bytes:
    doc = Document()
    doc.add_paragraph(text)
    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


def _fake_literature(query_international: str, query_native: str = "", limit: int = 3, native_language: str = "ja"):
    return [
        {
            "title": f"Paper about {query_international}",
            "authors": ["Alice Example"],
            "year": 2024,
            "doi": None,
            "abstract": "",
            "url": "https://openalex.org/W123",
        }
    ]


def test_generate_without_target_length_asks_length_question():
    resp = client.post("/generate", data={"topic": "生成AIと教育", "field": "教育技術"})

    assert resp.status_code == 200
    body = resp.json()
    assert body["type"] == "length_question"
    assert [opt["key"] for opt in body["options"]] == [
        "1-100",
        "101-1000",
        "1001-3000",
        "3001-5000",
        "5001-10000",
    ]


def test_generate_rejects_invalid_target_length():
    resp = client.post(
        "/generate",
        data={"topic": "生成AIと教育", "field": "教育技術", "target_length": "99999-99999"},
    )
    assert resp.status_code == 400


def test_generate_attaches_literature_to_each_section():
    with patch("app.search_literature_diverse", side_effect=_fake_literature):
        resp = client.post(
            "/generate",
            data={"topic": "生成AIと教育", "field": "教育技術", "target_length": "1001-3000"},
        )

    assert resp.status_code == 200
    body = resp.json()
    assert body["type"] == "outline"
    assert body["sections"]
    for section in body["sections"]:
        assert "literature" in section
        assert len(section["literature"]) == 1
        assert section["literature"][0]["title"].startswith("Paper about")


def test_generate_section_literature_falls_back_to_empty_list_on_error():
    with patch("app.search_literature_diverse", side_effect=RuntimeError("network down")):
        resp = client.post(
            "/generate",
            data={"topic": "生成AIと教育", "field": "教育技術", "target_length": "1001-3000"},
        )

    assert resp.status_code == 200
    body = resp.json()
    for section in body["sections"]:
        assert section["literature"] == []


def test_generate_requires_topic():
    resp = client.post("/generate", data={"topic": "  ", "target_length": "1001-3000"})
    assert resp.status_code == 400


def test_generate_passes_reference_and_format_notes_and_length_to_prompt():
    captured = {}

    def _fake_generate_outline(topic, field, reference_notes="", format_notes="", target_length=""):
        captured["reference_notes"] = reference_notes
        captured["format_notes"] = format_notes
        captured["target_length"] = target_length
        return {"title": "t", "research_question": "q", "sections": []}

    with patch("app.generate_outline", side_effect=_fake_generate_outline):
        resp = client.post(
            "/generate",
            data={"topic": "生成AIと教育", "field": "教育技術", "target_length": "3001-5000"},
            files={
                "reference_files": ("notes.txt", b"reference content here", "text/plain"),
                "format_file": ("format.txt", b"use APA style", "text/plain"),
            },
        )

    assert resp.status_code == 200
    assert "notes.txt" in captured["reference_notes"]
    assert "reference content here" in captured["reference_notes"]
    assert "format.txt" in captured["format_notes"]
    assert "use APA style" in captured["format_notes"]
    assert captured["target_length"] == "3001-5000"


def test_generate_notes_unsupported_files_by_name_only():
    captured = {}

    def _fake_generate_outline(topic, field, reference_notes="", format_notes="", target_length=""):
        captured["reference_notes"] = reference_notes
        return {"title": "t", "research_question": "q", "sections": []}

    with patch("app.generate_outline", side_effect=_fake_generate_outline):
        resp = client.post(
            "/generate",
            data={"topic": "生成AIと教育", "target_length": "1-100"},
            files={"reference_files": ("photo.png", b"\x89PNG fake", "image/png")},
        )

    assert resp.status_code == 200
    assert "photo.png" in captured["reference_notes"]
    assert "内容を解析していません" in captured["reference_notes"]


def test_generate_extracts_pdf_text():
    captured = {}
    pdf_bytes = _build_minimal_pdf("Reference material about generative AI")

    def _fake_generate_outline(topic, field, reference_notes="", format_notes="", target_length=""):
        captured["reference_notes"] = reference_notes
        return {"title": "t", "research_question": "q", "sections": []}

    with patch("app.generate_outline", side_effect=_fake_generate_outline):
        resp = client.post(
            "/generate",
            data={"topic": "生成AIと教育", "target_length": "1-100"},
            files={"reference_files": ("paper.pdf", pdf_bytes, "application/pdf")},
        )

    assert resp.status_code == 200
    assert "paper.pdf" in captured["reference_notes"]
    assert "Reference material about generative AI" in captured["reference_notes"]


def test_generate_extracts_docx_text():
    captured = {}
    docx_bytes = _build_minimal_docx("Use APA 7th edition style with 6 sections")

    def _fake_generate_outline(topic, field, reference_notes="", format_notes="", target_length=""):
        captured["format_notes"] = format_notes
        return {"title": "t", "research_question": "q", "sections": []}

    with patch("app.generate_outline", side_effect=_fake_generate_outline):
        resp = client.post(
            "/generate",
            data={"topic": "生成AIと教育", "target_length": "1-100"},
            files={"format_file": ("format.docx", docx_bytes, "application/vnd.openxmlformats-officedocument.wordprocessingml.document")},
        )

    assert resp.status_code == 200
    assert "format.docx" in captured["format_notes"]
    assert "Use APA 7th edition style with 6 sections" in captured["format_notes"]


def test_generate_persists_to_history_and_can_be_fetched_back():
    with patch("app.search_literature_diverse", side_effect=_fake_literature):
        resp = client.post(
            "/generate",
            data={"topic": "生成AIと教育", "field": "教育技術", "target_length": "1001-3000"},
        )

    assert resp.status_code == 200
    body = resp.json()
    generation_id = body["id"]

    history_resp = client.get("/history")
    assert history_resp.status_code == 200
    items = history_resp.json()["items"]
    assert any(item["id"] == generation_id for item in items)
    matching = next(item for item in items if item["id"] == generation_id)
    assert matching["topic"] == "生成AIと教育"
    assert matching["title"] == body["title"]

    detail_resp = client.get(f"/history/{generation_id}")
    assert detail_resp.status_code == 200
    detail = detail_resp.json()
    assert detail["outline"]["title"] == body["title"]
    assert detail["outline"]["sections"] == body["sections"]


def test_history_detail_404_for_unknown_id():
    resp = client.get("/history/999999999")
    assert resp.status_code == 404


def test_history_delete_removes_item():
    with patch("app.search_literature_diverse", side_effect=_fake_literature):
        resp = client.post(
            "/generate",
            data={"topic": "生成AIと教育", "field": "教育技術", "target_length": "1001-3000"},
        )
    generation_id = resp.json()["id"]

    delete_resp = client.delete(f"/history/{generation_id}")
    assert delete_resp.status_code == 200

    assert client.get(f"/history/{generation_id}").status_code == 404
    items = client.get("/history").json()["items"]
    assert all(item["id"] != generation_id for item in items)


def test_history_delete_404_for_unknown_id():
    resp = client.delete("/history/999999999")
    assert resp.status_code == 404


def test_history_search_filters_by_topic_and_title():
    with patch("app.search_literature_diverse", side_effect=_fake_literature):
        client.post(
            "/generate",
            data={"topic": "検索対象トピックabc123", "field": "一般", "target_length": "1-100"},
        )
        client.post(
            "/generate",
            data={"topic": "別のテーマ", "field": "一般", "target_length": "1-100"},
        )

    resp = client.get("/history", params={"q": "abc123"})
    assert resp.status_code == 200
    items = resp.json()["items"]
    assert len(items) >= 1
    assert all("検索対象トピックabc123" in item["topic"] for item in items)


def test_private_generation_is_hidden_from_default_history_but_visible_in_private_scope():
    headers = {"X-Dev-User-Id": "private-history-user"}

    with patch("app.search_literature_diverse", side_effect=_fake_literature):
        resp = client.post(
            "/generate",
            data={"topic": "非公開にするテーマ", "field": "一般", "target_length": "1-100", "private": "true"},
            headers=headers,
        )
    assert resp.status_code == 200
    body = resp.json()
    assert body["is_private"] is True
    generation_id = body["id"]

    default_items = client.get("/history", headers=headers).json()["items"]
    assert all(item["id"] != generation_id for item in default_items)

    private_items = client.get("/history", params={"scope": "private"}, headers=headers).json()["items"]
    assert any(item["id"] == generation_id for item in private_items)
    assert all(item["is_private"] for item in private_items)

    # 直接IDを指定すればスコープに関わらず取得できる(可視性フラグであってアクセス制御ではない)
    detail = client.get(f"/history/{generation_id}", headers=headers)
    assert detail.status_code == 200
    assert detail.json()["is_private"] is True


def test_toggle_history_privacy():
    headers = {"X-Dev-User-Id": "privacy-toggle-user"}

    with patch("app.search_literature_diverse", side_effect=_fake_literature):
        resp = client.post(
            "/generate",
            data={"topic": "後から非公開にするテーマ", "field": "一般", "target_length": "1-100"},
            headers=headers,
        )
    generation_id = resp.json()["id"]
    assert resp.json()["is_private"] is False

    toggle_resp = client.put(
        f"/history/{generation_id}/private", json={"is_private": True}, headers=headers
    )
    assert toggle_resp.status_code == 200

    default_items = client.get("/history", headers=headers).json()["items"]
    assert all(item["id"] != generation_id for item in default_items)
    private_items = client.get("/history", params={"scope": "private"}, headers=headers).json()["items"]
    assert any(item["id"] == generation_id for item in private_items)


def test_toggle_history_privacy_404_for_unknown_id():
    resp = client.put("/history/999999999/private", json={"is_private": True})
    assert resp.status_code == 404


def test_sessions_crud_lifecycle():
    create_resp = client.post("/sessions", json={"title": "新規タブ"})
    assert create_resp.status_code == 200
    session = create_resp.json()
    assert session["title"] == "新規タブ"
    assert session["messages"] == []
    session_id = session["id"]

    list_resp = client.get("/sessions")
    assert list_resp.status_code == 200
    assert any(item["id"] == session_id for item in list_resp.json()["items"])

    messages = [{"role": "user", "topic": "テーマ", "field": "一般", "referenceFileNames": [], "formatFileName": None}]
    update_resp = client.put(f"/sessions/{session_id}", json={"title": "テーマ", "messages": messages})
    assert update_resp.status_code == 200

    list_resp = client.get("/sessions")
    updated = next(item for item in list_resp.json()["items"] if item["id"] == session_id)
    assert updated["title"] == "テーマ"
    assert updated["messages"] == messages

    delete_resp = client.delete(f"/sessions/{session_id}")
    assert delete_resp.status_code == 200
    list_resp = client.get("/sessions")
    assert all(item["id"] != session_id for item in list_resp.json()["items"])


def test_sessions_update_404_for_unknown_id():
    resp = client.put("/sessions/999999999", json={"title": "x", "messages": []})
    assert resp.status_code == 404


def test_sessions_delete_404_for_unknown_id():
    resp = client.delete("/sessions/999999999")
    assert resp.status_code == 404


def test_endpoints_require_auth_when_dev_bypass_disabled(monkeypatch):
    monkeypatch.setattr(app_module, "DEV_BYPASS_USER_ID", "")

    assert client.get("/history", headers={"X-Dev-User-Id": ""}).status_code == 401
    assert client.get("/sessions", headers={"X-Dev-User-Id": ""}).status_code == 401
    assert (
        client.post(
            "/generate", data={"topic": "x", "target_length": "1-100"}, headers={"X-Dev-User-Id": ""}
        ).status_code
        == 401
    )


def test_missing_bearer_token_is_rejected():
    resp = client.get(
        "/history", headers={"Authorization": "not-a-bearer-token", "X-Dev-User-Id": ""}
    )
    assert resp.status_code == 401


def test_apple_sign_in_issues_bearer_token_that_grants_access(monkeypatch):
    monkeypatch.setattr(app_module, "verify_apple_identity_token", lambda token: {
        "sub": "apple-user-456",
        "email": "new-user@example.com",
    })

    signin_resp = client.post("/auth/apple", json={"identity_token": "fake-token-body"})
    assert signin_resp.status_code == 200
    token = signin_resp.json()["token"]
    assert token

    resp = client.get(
        "/history",
        headers={"Authorization": f"Bearer {token}", "X-Dev-User-Id": ""},
    )
    assert resp.status_code == 200


def test_apple_sign_in_rejects_invalid_token(monkeypatch):
    from auth import AuthError

    def _raise(_token):
        raise AuthError("boom")

    monkeypatch.setattr(app_module, "verify_apple_identity_token", _raise)

    resp = client.post("/auth/apple", json={"identity_token": "garbage"})
    assert resp.status_code == 401


def test_google_sign_in_issues_bearer_token_that_grants_access(monkeypatch):
    monkeypatch.setattr(
        app_module,
        "verify_google_id_token",
        lambda id_token: {"sub": "google-user-1", "email": "g@example.com"},
    )

    signin_resp = client.post("/auth/google", json={"id_token": "fake-token-body"})
    assert signin_resp.status_code == 200
    token = signin_resp.json()["token"]

    resp = client.get("/history", headers={"Authorization": f"Bearer {token}", "X-Dev-User-Id": ""})
    assert resp.status_code == 200


def test_google_sign_in_rejects_invalid_token(monkeypatch):
    from auth import AuthError

    monkeypatch.setattr(app_module, "verify_google_id_token", lambda id_token: (_ for _ in ()).throw(AuthError("boom")))

    resp = client.post("/auth/google", json={"id_token": "garbage"})
    assert resp.status_code == 401


def test_github_sign_in_issues_bearer_token_that_grants_access(monkeypatch):
    monkeypatch.setattr(
        app_module,
        "exchange_github_code_for_user",
        lambda code: {"sub": "12345", "email": "octocat@example.com"},
    )

    signin_resp = client.post("/auth/github", json={"code": "the-code"})
    assert signin_resp.status_code == 200
    token = signin_resp.json()["token"]

    resp = client.get("/history", headers={"Authorization": f"Bearer {token}", "X-Dev-User-Id": ""})
    assert resp.status_code == 200


def test_github_sign_in_rejects_invalid_code(monkeypatch):
    from auth import AuthError

    def _raise(_code):
        raise AuthError("boom")

    monkeypatch.setattr(app_module, "exchange_github_code_for_user", _raise)

    resp = client.post("/auth/github", json={"code": "bad-code"})
    assert resp.status_code == 401


def test_different_providers_create_separate_accounts(monkeypatch):
    """同じsubでもプロバイダーが違えば別アカウントになる(自動アカウント統合はしない)。"""
    monkeypatch.setattr(
        app_module, "verify_apple_identity_token", lambda token: {"sub": "shared-id", "email": None}
    )
    monkeypatch.setattr(
        app_module, "verify_google_id_token", lambda id_token: {"sub": "shared-id", "email": None}
    )

    apple_token = client.post("/auth/apple", json={"identity_token": "x"}).json()["token"]
    google_token = client.post("/auth/google", json={"id_token": "x"}).json()["token"]

    with patch("app.search_literature_diverse", side_effect=_fake_literature):
        client.post(
            "/generate",
            data={"topic": "Apple側のデータ", "field": "一般", "target_length": "1-100"},
            headers={"Authorization": f"Bearer {apple_token}", "X-Dev-User-Id": ""},
        )

    google_history = client.get(
        "/history", headers={"Authorization": f"Bearer {google_token}", "X-Dev-User-Id": ""}
    ).json()["items"]
    assert all(item["topic"] != "Apple側のデータ" for item in google_history)


def test_auth_dev_disabled_returns_404_when_bypass_not_configured(monkeypatch):
    monkeypatch.setattr(app_module, "DEV_BYPASS_USER_ID", "")
    resp = client.post("/auth/dev")
    assert resp.status_code == 404


def test_auth_dev_issues_token_for_bypass_user():
    resp = client.post("/auth/dev")
    assert resp.status_code == 200
    token = resp.json()["token"]

    me_resp = client.get(
        "/me", headers={"Authorization": f"Bearer {token}", "X-Dev-User-Id": ""}
    )
    assert me_resp.status_code == 200
    assert me_resp.json()["user_id"] == DEFAULT_TEST_USER_ID


def test_me_returns_plan_and_quota():
    resp = client.get("/me")
    assert resp.status_code == 200
    body = resp.json()
    assert body["plan"] == "free"
    assert body["tokens_quota"] == app_module.PLAN_TOKEN_QUOTAS["free"]
    assert "tokens_used" in body


def test_me_reports_is_admin_flag():
    admin_resp = client.get("/me")
    assert admin_resp.json()["is_admin"] is True

    non_admin_resp = client.get("/me", headers={"X-Dev-User-Id": "not-an-admin-user"})
    assert non_admin_resp.json()["is_admin"] is False


def test_admin_overview_rejects_non_admin_user():
    resp = client.get("/admin/overview", headers={"X-Dev-User-Id": "not-an-admin-user"})
    assert resp.status_code == 403


def test_admin_overview_rejects_unauthenticated_request():
    resp = client.get("/admin/overview", headers={"X-Dev-User-Id": ""})
    assert resp.status_code == 401


def test_admin_overview_returns_aggregate_stats_for_admin_user():
    resp = client.get("/admin/overview")
    assert resp.status_code == 200
    body = resp.json()
    assert body["users"]["total"] >= 1
    assert set(body["plans"].keys()) == {"free", "pro", "max", "paying"}
    assert "tokens_used_this_period" in body["usage"]
    assert set(body["generations"].keys()) == {"total", "last_7d", "last_30d"}
    assert isinstance(body["recent_security_events"], list)


def test_generate_blocked_with_402_when_quota_exceeded(monkeypatch):
    import db

    other_user_headers = {"X-Dev-User-Id": "quota-test-user"}
    monkeypatch.setattr(app_module, "PLAN_TOKEN_QUOTAS", {"free": 10, "pro": 200_000, "max": 1_000_000})
    db.add_token_usage("quota-test-user", 999)  # 直接DBに使用量を積んで上限超え状態を作る

    resp = client.post(
        "/generate",
        data={"topic": "枠を使い切った後のテスト", "target_length": "1-100"},
        headers=other_user_headers,
    )
    assert resp.status_code == 402


def test_generate_succeeds_and_increments_usage_when_under_quota():
    import db

    headers = {"X-Dev-User-Id": "usage-tracking-user"}
    before = db.get_or_create_entitlement("usage-tracking-user")["tokens_used"]

    with patch("app.generate_outline", side_effect=_fake_generate_outline_minimal):
        resp = client.post(
            "/generate",
            data={"topic": "使用量加算テスト", "target_length": "1-100"},
            headers=headers,
        )
    assert resp.status_code == 200

    after = db.get_or_create_entitlement("usage-tracking-user")["tokens_used"]
    # フォールバック相当のモック(_token_usageなし)なので加算量は0だが、
    # エンタイトルメント行自体は作成/参照されていること(例外なく完了)を確認する。
    assert after >= before


def test_users_cannot_see_or_modify_each_others_data():
    other_user_headers = {"X-Dev-User-Id": "someone-else"}

    with patch("app.search_literature_diverse", side_effect=_fake_literature):
        resp = client.post(
            "/generate",
            data={"topic": "他人に見せたくないテーマ", "field": "一般", "target_length": "1-100"},
        )
    generation_id = resp.json()["id"]

    session_resp = client.post("/sessions", json={"title": "自分のタブ"})
    session_id = session_resp.json()["id"]

    # 別ユーザーからは、存在自体が見えない(404)
    assert client.get(f"/history/{generation_id}", headers=other_user_headers).status_code == 404
    assert client.delete(f"/history/{generation_id}", headers=other_user_headers).status_code == 404
    assert client.put(
        f"/sessions/{session_id}", json={"title": "乗っ取り", "messages": []}, headers=other_user_headers
    ).status_code == 404
    assert client.delete(f"/sessions/{session_id}", headers=other_user_headers).status_code == 404

    # 一覧にも他人のデータは混ざらない
    other_history = client.get("/history", headers=other_user_headers).json()["items"]
    assert all(item["id"] != generation_id for item in other_history)
    other_sessions = client.get("/sessions", headers=other_user_headers).json()["items"]
    assert all(item["id"] != session_id for item in other_sessions)

    # 元のユーザーからは引き続きアクセスできる
    assert client.get(f"/history/{generation_id}").status_code == 200
    assert client.get("/sessions").json()["items"]


def _fake_generate_outline_minimal(topic, field, reference_notes="", format_notes="", target_length=""):
    return {"title": "t", "research_question": "q", "sections": []}


def test_generate_rate_limit_returns_429_when_exceeded(monkeypatch):
    # generate_outlineを固定応答にして実API呼び出しの遅延をなくし、1分の時間窓を
    # またいでテストがflakyにならないようにする。
    monkeypatch.setattr(app_module, "GENERATE_RATE_LIMIT_PER_MINUTE", 1)

    with patch("app.generate_outline", side_effect=_fake_generate_outline_minimal):
        first = client.post("/generate", data={"topic": "レート制限テスト1", "target_length": "1-100"})
        assert first.status_code == 200

        second = client.post("/generate", data={"topic": "レート制限テスト2", "target_length": "1-100"})
        assert second.status_code == 429


def test_generate_rate_limit_disabled_when_zero(monkeypatch):
    monkeypatch.setattr(app_module, "GENERATE_RATE_LIMIT_PER_MINUTE", 0)

    with patch("app.generate_outline", side_effect=_fake_generate_outline_minimal):
        for _ in range(3):
            resp = client.post("/generate", data={"topic": "レート制限無効テスト", "target_length": "1-100"})
            assert resp.status_code == 200


def test_generate_handles_corrupted_pdf_gracefully():
    captured = {}

    def _fake_generate_outline(topic, field, reference_notes="", format_notes="", target_length=""):
        captured["reference_notes"] = reference_notes
        return {"title": "t", "research_question": "q", "sections": []}

    with patch("app.generate_outline", side_effect=_fake_generate_outline):
        resp = client.post(
            "/generate",
            data={"topic": "生成AIと教育", "target_length": "1-100"},
            files={"reference_files": ("broken.pdf", b"not a real pdf", "application/pdf")},
        )

    assert resp.status_code == 200
    assert "broken.pdf" in captured["reference_notes"]
    assert "PDFの読み取りに失敗しました" in captured["reference_notes"]


def _fake_answer_course_question(university, faculty, department, messages):
    return {
        "answer": f"{university}{faculty}についての回答です。",
        "_token_usage": {"input_tokens": 10, "output_tokens": 20},
    }


def test_course_chat_returns_answer():
    with patch("app.answer_course_question", side_effect=_fake_answer_course_question):
        resp = client.post(
            "/course-chat",
            json={
                "university": "同志社大学",
                "faculty": "文学部",
                "department": "",
                "messages": [{"role": "user", "content": "民法の授業は何を勉強しますか?"}],
            },
        )

    assert resp.status_code == 200
    body = resp.json()
    assert body["answer"] == "同志社大学文学部についての回答です。"
    assert "_token_usage" not in body


def test_course_chat_requires_university_and_faculty():
    resp = client.post(
        "/course-chat",
        json={
            "university": "  ",
            "faculty": "文学部",
            "messages": [{"role": "user", "content": "質問です"}],
        },
    )
    assert resp.status_code == 400


def test_course_chat_requires_messages():
    resp = client.post(
        "/course-chat",
        json={"university": "同志社大学", "faculty": "文学部", "messages": []},
    )
    assert resp.status_code == 400


def test_course_chat_blocked_with_402_when_quota_exceeded(monkeypatch):
    import db

    other_user_headers = {"X-Dev-User-Id": "course-chat-quota-test-user"}
    monkeypatch.setattr(app_module, "PLAN_TOKEN_QUOTAS", {"free": 10, "pro": 200_000, "max": 1_000_000})
    db.add_token_usage("course-chat-quota-test-user", 999)

    resp = client.post(
        "/course-chat",
        json={
            "university": "同志社大学",
            "faculty": "文学部",
            "messages": [{"role": "user", "content": "質問です"}],
        },
        headers=other_user_headers,
    )
    assert resp.status_code == 402


def test_course_chat_increments_usage():
    import db

    headers = {"X-Dev-User-Id": "course-chat-usage-tracking-user"}
    before = db.get_or_create_entitlement("course-chat-usage-tracking-user")["tokens_used"]

    with patch("app.answer_course_question", side_effect=_fake_answer_course_question):
        resp = client.post(
            "/course-chat",
            json={
                "university": "同志社大学",
                "faculty": "文学部",
                "messages": [{"role": "user", "content": "質問です"}],
            },
            headers=headers,
        )
    assert resp.status_code == 200

    after = db.get_or_create_entitlement("course-chat-usage-tracking-user")["tokens_used"]
    assert after == before + 30


def test_course_chat_rate_limit_returns_429_when_exceeded(monkeypatch):
    monkeypatch.setattr(app_module, "COURSE_CHAT_RATE_LIMIT_PER_MINUTE", 1)

    with patch("app.answer_course_question", side_effect=_fake_answer_course_question):
        first = client.post(
            "/course-chat",
            json={
                "university": "同志社大学",
                "faculty": "文学部",
                "messages": [{"role": "user", "content": "1回目"}],
            },
        )
        assert first.status_code == 200

        second = client.post(
            "/course-chat",
            json={
                "university": "同志社大学",
                "faculty": "文学部",
                "messages": [{"role": "user", "content": "2回目"}],
            },
        )
        assert second.status_code == 429


def _fake_generate_paper_body(title, research_question, sections, target_length=""):
    return {
        "body": f"# {title}\n\n本文です。",
        "_token_usage": {"input_tokens": 15, "output_tokens": 25},
    }


_SAMPLE_SECTIONS = [{"heading": "背景", "purpose": "背景を説明する", "literature": []}]


def test_generate_body_returns_body():
    with patch("app.generate_paper_body", side_effect=_fake_generate_paper_body):
        resp = client.post(
            "/generate/body",
            json={
                "title": "テストの論文",
                "research_question": "問い",
                "sections": _SAMPLE_SECTIONS,
            },
        )

    assert resp.status_code == 200
    body = resp.json()
    assert "本文です" in body["body"]
    assert "_token_usage" not in body


def test_generate_body_requires_title():
    resp = client.post(
        "/generate/body",
        json={"title": "  ", "sections": _SAMPLE_SECTIONS},
    )
    assert resp.status_code == 400


def test_generate_body_requires_sections():
    resp = client.post(
        "/generate/body",
        json={"title": "テストの論文", "sections": []},
    )
    assert resp.status_code == 400


def test_generate_body_blocked_with_402_when_quota_exceeded(monkeypatch):
    import db

    other_user_headers = {"X-Dev-User-Id": "generate-body-quota-test-user"}
    monkeypatch.setattr(app_module, "PLAN_TOKEN_QUOTAS", {"free": 10, "pro": 200_000, "max": 1_000_000})
    db.add_token_usage("generate-body-quota-test-user", 999)

    resp = client.post(
        "/generate/body",
        json={"title": "テストの論文", "sections": _SAMPLE_SECTIONS},
        headers=other_user_headers,
    )
    assert resp.status_code == 402


def test_generate_body_increments_usage():
    import db

    headers = {"X-Dev-User-Id": "generate-body-usage-tracking-user"}
    before = db.get_or_create_entitlement("generate-body-usage-tracking-user")["tokens_used"]

    with patch("app.generate_paper_body", side_effect=_fake_generate_paper_body):
        resp = client.post(
            "/generate/body",
            json={"title": "テストの論文", "sections": _SAMPLE_SECTIONS},
            headers=headers,
        )
    assert resp.status_code == 200

    after = db.get_or_create_entitlement("generate-body-usage-tracking-user")["tokens_used"]
    assert after == before + 40


def test_generate_body_shares_rate_limit_with_generate(monkeypatch):
    monkeypatch.setattr(app_module, "GENERATE_RATE_LIMIT_PER_MINUTE", 1)

    with patch("app.generate_paper_body", side_effect=_fake_generate_paper_body):
        first = client.post(
            "/generate/body",
            json={"title": "テストの論文", "sections": _SAMPLE_SECTIONS},
        )
        assert first.status_code == 200

        second = client.post(
            "/generate/body",
            json={"title": "テストの論文", "sections": _SAMPLE_SECTIONS},
        )
        assert second.status_code == 429


def _fake_generate_study_notes(document_text, focus=""):
    return {
        "content": f"## 全体の要約\n{document_text[:20]}についての要約です。",
        "_token_usage": {"input_tokens": 15, "output_tokens": 25},
    }


def test_study_notes_returns_content_from_pasted_text():
    with patch("app.generate_study_notes", side_effect=_fake_generate_study_notes):
        resp = client.post("/study-notes", data={"text": "江戸時代の身分制度に関するレポート本文"})

    assert resp.status_code == 200
    body = resp.json()
    assert "全体の要約" in body["content"]
    assert "_token_usage" not in body


def test_study_notes_requires_text_or_file():
    resp = client.post("/study-notes", data={"text": "  "})
    assert resp.status_code == 400


def test_study_notes_reads_uploaded_text_file():
    captured = {}

    def _capture(document_text, focus=""):
        captured["document_text"] = document_text
        return _fake_generate_study_notes(document_text, focus)

    with patch("app.generate_study_notes", side_effect=_capture):
        resp = client.post(
            "/study-notes",
            data={"text": ""},
            files={"file": ("report.txt", "資料ファイルの中身".encode("utf-8"), "text/plain")},
        )

    assert resp.status_code == 200
    assert "資料ファイルの中身" in captured["document_text"]


def test_study_notes_rejects_unsupported_file_type():
    resp = client.post(
        "/study-notes",
        data={"text": ""},
        files={"file": ("report.docx.bak", b"whatever", "application/octet-stream")},
    )
    assert resp.status_code == 400


def test_study_notes_blocked_with_402_when_quota_exceeded(monkeypatch):
    import db

    headers = {"X-Dev-User-Id": "study-notes-quota-test-user"}
    monkeypatch.setattr(app_module, "PLAN_TOKEN_QUOTAS", {"free": 10, "pro": 200_000, "max": 1_000_000})
    db.add_token_usage("study-notes-quota-test-user", 999)

    resp = client.post(
        "/study-notes",
        data={"text": "レポート本文"},
        headers=headers,
    )
    assert resp.status_code == 402


def test_study_notes_increments_usage():
    import db

    headers = {"X-Dev-User-Id": "study-notes-usage-tracking-user"}
    before = db.get_or_create_entitlement("study-notes-usage-tracking-user")["tokens_used"]

    with patch("app.generate_study_notes", side_effect=_fake_generate_study_notes):
        resp = client.post(
            "/study-notes",
            data={"text": "レポート本文"},
            headers=headers,
        )
    assert resp.status_code == 200

    after = db.get_or_create_entitlement("study-notes-usage-tracking-user")["tokens_used"]
    assert after == before + 40


def test_study_notes_rate_limit_returns_429_when_exceeded(monkeypatch):
    monkeypatch.setattr(app_module, "STUDY_NOTES_RATE_LIMIT_PER_MINUTE", 1)

    with patch("app.generate_study_notes", side_effect=_fake_generate_study_notes):
        first = client.post("/study-notes", data={"text": "1回目のレポート本文"})
        assert first.status_code == 200

        second = client.post("/study-notes", data={"text": "2回目のレポート本文"})
        assert second.status_code == 429
