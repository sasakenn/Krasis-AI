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
    # 正規化後は同じメールアドレスなので、既存アカウント宛にコードを再発行するだけで
    # 200を返す(以下のtest_signup_does_not_leak_whether_email_is_already_registered参照)。
    assert dup.status_code == 200


def test_signup_rejects_invalid_email():
    resp = client.post("/auth/code/signup", json={"email": "not-an-email"})
    assert resp.status_code == 400


def test_signup_does_not_leak_whether_email_is_already_registered():
    """既に登録済みのメールアドレスでもう一度サインアップを叩いても、以前のように409を
    返して登録の有無を教えない(account enumeration対策)。代わりに再発行と同様に
    新しいコードを同じアカウント宛に送るだけにする。
    """
    email = "dup@example.com"
    body, first_code = _signup(email)
    assert "token" not in body

    with patch("app.send_email") as mock_send_email:
        second = client.post("/auth/code/signup", json={"email": email})
    assert second.status_code == 200
    _, _, message_body = mock_send_email.call_args.args
    second_code = _extract_code_from_message(message_body)
    assert second_code != first_code

    # 古いコードはもう使えない(再発行と同じ扱いで無効化される)
    old_login = client.post("/auth/code/login", json={"email": email, "code": first_code})
    assert old_login.status_code == 401

    # 新しいコードは、最初にサインアップした同じアカウントとしてログインできる
    # (新しい別アカウントが作られたわけではない)。
    new_login = client.post("/auth/code/login", json={"email": email, "code": second_code})
    assert new_login.status_code == 200


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


def test_code_auth_endpoints_are_rate_limited_per_source_ip_too(monkeypatch):
    """メールアドレス単位の制限とは別に、1つのIPから多数の他人のメールアドレスへ
    次々とコードを送りつける迷惑メール踏み台を防ぐIP単位の制限があることの回帰テスト。
    """
    monkeypatch.setattr(app_module, "CODE_AUTH_IP_RATE_LIMIT_PER_MINUTE", 2)
    headers = {"X-Forwarded-For": "198.51.100.7"}

    with patch("app.send_email"):
        first = client.post("/auth/code/signup", json={"email": "victim1@example.com"}, headers=headers)
        assert first.status_code == 200

        second = client.post("/auth/code/signup", json={"email": "victim2@example.com"}, headers=headers)
        assert second.status_code == 200

        # 3件目は宛先メールアドレスが毎回違うのでメール単位の制限には引っかからないが、
        # 同じIPからの合計リクエスト数がIP単位の上限を超えるため429になる。
        third = client.post("/auth/code/signup", json={"email": "victim3@example.com"}, headers=headers)
        assert third.status_code == 429


def test_reused_hash_is_timing_safe_compared():
    # hmac.compare_digestが実際に使われていることを確認する(単純な==比較への退行防止)。
    with patch("app.hmac.compare_digest", wraps=__import__("hmac").compare_digest) as mock_compare:
        _, code = _signup("timing-safe-test@example.com")
        client.post("/auth/code/login", json={"email": "timing-safe-test@example.com", "code": code})

    assert mock_compare.called


def test_code_hash_uses_a_server_side_pepper_not_plain_sha256():
    """DBダンプだけでオフライン総当たりできないよう、単純なSHA256ではなくpepper付きHMACで
    ハッシュしていることの回帰テスト。"""
    import hashlib

    _, code = _signup("pepper-test@example.com")
    record = db.get_code_login_by_email("pepper-test@example.com")

    naive_sha256 = hashlib.sha256(code.strip().encode("utf-8")).hexdigest()
    assert record["code_hash"] != naive_sha256


def test_expired_login_code_is_rejected(monkeypatch):
    """発行から長時間経ったログインコードは、値が正しくてもログインに使えない
    (単なる乱数が"恒久パスワード"化するのを防ぐ)回帰テスト。"""
    monkeypatch.setattr(app_module, "CODE_LOGIN_TTL_SECONDS", 1)
    email = "expiring-code-test@example.com"
    _, code = _signup(email)

    import time
    time.sleep(1.2)

    resp = client.post("/auth/code/login", json={"email": email, "code": code})
    assert resp.status_code == 401
    assert "有効期限" in resp.json()["detail"]


def test_reissue_resets_the_code_expiry(monkeypatch):
    """再発行すると有効期限もリセットされ、新しいコードは(元のコードの発行時刻からは
    既に期限切れであっても)まだ有効であることの回帰テスト。"""
    monkeypatch.setattr(app_module, "CODE_LOGIN_TTL_SECONDS", 1)
    email = "reissue-resets-expiry-test@example.com"
    _, old_code = _signup(email)

    import time
    time.sleep(1.2)

    with patch("app.send_email") as mock_send_email:
        reissue = client.post("/auth/code/reissue", json={"email": email})
    assert reissue.status_code == 200
    _, _, message_body = mock_send_email.call_args.args
    new_code = _extract_code_from_message(message_body)

    resp = client.post("/auth/code/login", json={"email": email, "code": new_code})
    assert resp.status_code == 200
