from unittest.mock import patch

from fastapi.testclient import TestClient

import app as app_module
import db
from app import app

client = TestClient(app)


def _extract_code_from_message(message_body: str) -> str:
    """メール本文から12桁(16進数)のログインコードを取り出す(テスト専用)。"""
    return next(
        line.strip()
        for line in message_body.splitlines()
        if len(line.strip()) == 12 and all(c in "0123456789abcdef" for c in line.strip())
    )


def _signup(email: str) -> tuple[dict, str]:
    """テスト用: サインアップし、(レスポンスJSON, メールで送られたコード)を返す。

    コードの持ち主であることを確認する前にセッションを発行しないよう、
    サインアップ単体ではトークンを返さない仕様(下記test_signup_does_not_issue_a_token_before_code_verification
    参照)。トークンが必要なテストは_signup_and_loginを使う。
    """
    with patch("app.send_email") as mock_send_email:
        resp = client.post("/auth/code/signup", json={"email": email})
    assert resp.status_code == 200
    _, _, message_body = mock_send_email.call_args.args
    return resp.json(), _extract_code_from_message(message_body)


def _signup_and_login(email: str) -> tuple[dict, str]:
    """テスト用: サインアップ後、メールで届いたコードで実際にログインまで行い、
    (ログインレスポンスJSON, コード)を返す。MFA未設定のアカウント向け。
    """
    _, code = _signup(email)
    resp = client.post("/auth/code/login", json={"email": email, "code": code})
    assert resp.status_code == 200
    assert resp.json()["token"]
    return resp.json(), code


def test_signup_does_not_issue_a_token_before_code_verification():
    """サインアップ直後(コードをまだ誰も入力していない段階)ではセッショントークンを
    発行しない。他人のメールアドレスでサインアップするだけでそのアカウントに
    ログインできてしまう脆弱性の回帰テスト。
    """
    with patch("app.send_email") as mock_send_email:
        resp = client.post("/auth/code/signup", json={"email": "new-user@example.com"})

    assert resp.status_code == 200
    body = resp.json()
    assert "token" not in body
    assert "code" not in body  # コードは画面にもAPIレスポンスにも出さず、メールでのみ届ける

    mock_send_email.assert_called_once()
    to, subject, message_body = mock_send_email.call_args.args
    assert to == "new-user@example.com"
    code = _extract_code_from_message(message_body)
    assert len(code) == 12
    int(code, 16)  # 16進数として解釈できる(=乱数コードの形式)

    # コードを正しく入力して初めてトークンが発行される
    login = client.post("/auth/code/login", json={"email": "new-user@example.com", "code": code})
    assert login.status_code == 200
    token = login.json()["token"]
    assert token

    resp2 = client.get("/history", headers={"Authorization": f"Bearer {token}", "X-Dev-User-Id": ""})
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
    _, code = _signup("login-test@example.com")

    resp = client.post("/auth/code/login", json={"email": "login-test@example.com", "code": code})
    assert resp.status_code == 200
    assert resp.json()["token"]


def test_login_with_wrong_code_fails():
    _signup("wrong-code-test@example.com")

    resp = client.post(
        "/auth/code/login", json={"email": "wrong-code-test@example.com", "code": "000000000000"}
    )
    assert resp.status_code == 401


def test_login_with_unknown_email_fails():
    resp = client.post("/auth/code/login", json={"email": "nobody@example.com", "code": "000000000000"})
    assert resp.status_code == 401


def test_reissue_replaces_code_and_invalidates_old_one():
    _, old_code = _signup("reissue-test@example.com")

    with patch("app.send_email") as mock_send_email:
        reissue = client.post("/auth/code/reissue", json={"email": "reissue-test@example.com"})
    assert reissue.status_code == 200
    mock_send_email.assert_called_once()
    _, _, message_body = mock_send_email.call_args.args
    new_code = _extract_code_from_message(message_body)

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


def test_reused_hash_is_timing_safe_compared():
    # hmac.compare_digestが実際に使われていることを確認する(単純な==比較への退行防止)。
    with patch("app.hmac.compare_digest", wraps=__import__("hmac").compare_digest) as mock_compare:
        _, code = _signup("timing-safe-test@example.com")
        client.post("/auth/code/login", json={"email": "timing-safe-test@example.com", "code": code})

    assert mock_compare.called
