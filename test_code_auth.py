from unittest.mock import patch

from fastapi.testclient import TestClient

import app as app_module
import db
from app import app

client = TestClient(app)


def test_signup_creates_account_and_returns_token_and_code():
    with patch("app.send_email") as mock_send_email:
        resp = client.post("/auth/code/signup", json={"email": "new-user@example.com"})

    assert resp.status_code == 200
    body = resp.json()
    assert body["token"]
    assert len(body["code"]) == 12
    int(body["code"], 16)  # 16進数として解釈できる(=乱数コードの形式)

    mock_send_email.assert_called_once()
    to, subject, message_body = mock_send_email.call_args.args
    assert to == "new-user@example.com"
    assert body["code"] in message_body

    # 発行されたトークンでAPIが叩けること
    resp2 = client.get("/history", headers={"Authorization": f"Bearer {body['token']}", "X-Dev-User-Id": ""})
    assert resp2.status_code == 200


def test_signup_normalizes_email_case_and_whitespace():
    with patch("app.send_email"):
        resp = client.post("/auth/code/signup", json={"email": "  Mixed-Case@Example.com  "})
    assert resp.status_code == 200

    with patch("app.send_email"):
        dup = client.post("/auth/code/signup", json={"email": "mixed-case@example.com"})
    assert dup.status_code == 409


def test_signup_rejects_invalid_email():
    resp = client.post("/auth/code/signup", json={"email": "not-an-email"})
    assert resp.status_code == 400


def test_signup_rejects_duplicate_email():
    with patch("app.send_email"):
        first = client.post("/auth/code/signup", json={"email": "dup@example.com"})
    assert first.status_code == 200

    with patch("app.send_email"):
        second = client.post("/auth/code/signup", json={"email": "dup@example.com"})
    assert second.status_code == 409


def test_login_with_correct_code_succeeds():
    with patch("app.send_email"):
        signup = client.post("/auth/code/signup", json={"email": "login-test@example.com"})
    code = signup.json()["code"]

    resp = client.post("/auth/code/login", json={"email": "login-test@example.com", "code": code})
    assert resp.status_code == 200
    assert resp.json()["token"]


def test_login_with_wrong_code_fails():
    with patch("app.send_email"):
        client.post("/auth/code/signup", json={"email": "wrong-code-test@example.com"})

    resp = client.post(
        "/auth/code/login", json={"email": "wrong-code-test@example.com", "code": "000000000000"}
    )
    assert resp.status_code == 401


def test_login_with_unknown_email_fails():
    resp = client.post("/auth/code/login", json={"email": "nobody@example.com", "code": "000000000000"})
    assert resp.status_code == 401


def test_reissue_replaces_code_and_invalidates_old_one():
    with patch("app.send_email"):
        signup = client.post("/auth/code/signup", json={"email": "reissue-test@example.com"})
    old_code = signup.json()["code"]

    with patch("app.send_email") as mock_send_email:
        reissue = client.post("/auth/code/reissue", json={"email": "reissue-test@example.com"})
    assert reissue.status_code == 200
    mock_send_email.assert_called_once()
    _, _, message_body = mock_send_email.call_args.args
    new_code = next(line for line in message_body.splitlines() if len(line) == 12 and all(c in "0123456789abcdef" for c in line))

    # 古いコードはもう使えない
    old_login = client.post("/auth/code/login", json={"email": "reissue-test@example.com", "code": old_code})
    assert old_login.status_code == 401

    # 新しいコードでログインできる
    new_login = client.post("/auth/code/login", json={"email": "reissue-test@example.com", "code": new_code})
    assert new_login.status_code == 200


def test_reissue_for_unknown_email_returns_generic_success_without_sending_mail():
    with patch("app.send_email") as mock_send_email:
        resp = client.post("/auth/code/reissue", json={"email": "never-signed-up@example.com"})

    assert resp.status_code == 200
    assert "登録されていれば" in resp.json()["message"]
    mock_send_email.assert_not_called()


def test_code_auth_endpoints_are_rate_limited(monkeypatch):
    monkeypatch.setattr(app_module, "CODE_AUTH_RATE_LIMIT_PER_MINUTE", 1)
    email = "rate-limit-test@example.com"

    with patch("app.send_email"):
        first = client.post("/auth/code/signup", json={"email": email})
        assert first.status_code == 200

        second = client.post("/auth/code/reissue", json={"email": email})
        assert second.status_code == 429


def test_reused_hash_is_timing_safe_compared(monkeypatch):
    # hmac.compare_digestが実際に使われていることを確認する(単純な==比較への退行防止)。
    with patch("app.hmac.compare_digest", wraps=__import__("hmac").compare_digest) as mock_compare:
        with patch("app.send_email"):
            signup = client.post("/auth/code/signup", json={"email": "timing-safe-test@example.com"})
        code = signup.json()["code"]
        client.post("/auth/code/login", json={"email": "timing-safe-test@example.com", "code": code})

    assert mock_compare.called
