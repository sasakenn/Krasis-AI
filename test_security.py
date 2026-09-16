import sqlite3

import pyotp
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient
from unittest.mock import patch

import app as app_module
import auth
import db
from app import app
from test_code_auth import _signup

client = TestClient(app)


def _auth_headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}", "X-Dev-User-Id": ""}


def test_mfa_setup_confirm_and_full_login_flow():
    body, code = _signup("mfa-flow@example.com")
    token = body["token"]
    headers = _auth_headers(token)

    status = client.get("/auth/mfa/status", headers=headers)
    assert status.json() == {"enabled": False, "pending": False}

    setup = client.post("/auth/mfa/setup", headers=headers)
    assert setup.status_code == 200
    secret = setup.json()["secret"]
    assert setup.json()["otpauth_url"].startswith("otpauth://totp/")

    status = client.get("/auth/mfa/status", headers=headers)
    assert status.json() == {"enabled": False, "pending": True}

    bad_confirm = client.post("/auth/mfa/confirm", json={"code": "000000"}, headers=headers)
    assert bad_confirm.status_code == 400

    confirm = client.post("/auth/mfa/confirm", json={"code": pyotp.TOTP(secret).now()}, headers=headers)
    assert confirm.status_code == 200
    assert confirm.json() == {"enabled": True}

    status = client.get("/auth/mfa/status", headers=headers)
    assert status.json() == {"enabled": True, "pending": False}

    # 以後、ログインコードだけではセッショントークンをもらえず、mfa_tokenが返る
    login = client.post("/auth/code/login", json={"email": "mfa-flow@example.com", "code": code})
    assert login.status_code == 200
    assert login.json()["mfa_required"] is True
    assert "token" not in login.json()
    mfa_token = login.json()["mfa_token"]

    bad_verify = client.post("/auth/mfa/verify", json={"mfa_token": mfa_token, "code": "000000"})
    assert bad_verify.status_code == 401

    good_verify = client.post(
        "/auth/mfa/verify", json={"mfa_token": mfa_token, "code": pyotp.TOTP(secret).now()}
    )
    assert good_verify.status_code == 200
    assert good_verify.json()["token"]


def test_mfa_disable_requires_current_code():
    body, _ = _signup("mfa-disable@example.com")
    headers = _auth_headers(body["token"])

    secret = client.post("/auth/mfa/setup", headers=headers).json()["secret"]
    client.post("/auth/mfa/confirm", json={"code": pyotp.TOTP(secret).now()}, headers=headers)

    wrong = client.post("/auth/mfa/disable", json={"code": "000000"}, headers=headers)
    assert wrong.status_code == 401

    right = client.post("/auth/mfa/disable", json={"code": pyotp.TOTP(secret).now()}, headers=headers)
    assert right.status_code == 200
    assert right.json() == {"enabled": False}

    status = client.get("/auth/mfa/status", headers=headers)
    assert status.json() == {"enabled": False, "pending": False}


def test_mfa_setup_blocked_when_already_enabled():
    body, _ = _signup("mfa-double-setup@example.com")
    headers = _auth_headers(body["token"])

    secret = client.post("/auth/mfa/setup", headers=headers).json()["secret"]
    client.post("/auth/mfa/confirm", json={"code": pyotp.TOTP(secret).now()}, headers=headers)

    second_setup = client.post("/auth/mfa/setup", headers=headers)
    assert second_setup.status_code == 409


def test_mfa_token_cannot_be_used_as_a_session_token():
    mfa_token = auth.create_mfa_token("some-other-user")
    resp = client.get("/history", headers={"Authorization": f"Bearer {mfa_token}", "X-Dev-User-Id": ""})
    assert resp.status_code == 401


def test_login_lockout_after_repeated_failures(monkeypatch):
    monkeypatch.setattr(app_module, "CODE_AUTH_MAX_FAILURES", 3)
    monkeypatch.setattr(app_module, "CODE_AUTH_LOCKOUT_SECONDS", 900)
    monkeypatch.setattr(app_module, "CODE_AUTH_RATE_LIMIT_PER_MINUTE", 0)  # レート制限と切り分ける
    email = "lockout-test@example.com"
    with patch("app.send_email"):
        client.post("/auth/code/signup", json={"email": email})

    for _ in range(3):
        resp = client.post("/auth/code/login", json={"email": email, "code": "000000000000"})
        assert resp.status_code == 401

    locked = client.post("/auth/code/login", json={"email": email, "code": "000000000000"})
    assert locked.status_code == 423


def test_encrypted_generation_content_round_trips(monkeypatch):
    key = Fernet.generate_key().decode("utf-8")
    monkeypatch.setattr("crypto_utils._fernet", Fernet(key.encode("utf-8")))

    outline = {"title": "暗号化テスト", "sections": []}
    gen_id = db.save_generation("encryption-test-user", "topic", "field", "1-100", outline)

    conn = sqlite3.connect(db.DB_PATH)
    raw = conn.execute("SELECT outline_json FROM generations WHERE id = ?", (gen_id,)).fetchone()[0]
    conn.close()
    assert raw.startswith("enc:v1:")
    assert "暗号化テスト" not in raw

    fetched = db.get_generation("encryption-test-user", gen_id)
    assert fetched["outline"]["title"] == "暗号化テスト"


def test_security_events_are_recorded_and_listable():
    body, _ = _signup("events-test@example.com")
    token = body["token"]
    client.post("/auth/code/login", json={"email": "events-test@example.com", "code": "000000000000"})

    events = client.get("/auth/security-events", headers=_auth_headers(token))
    assert events.status_code == 200
    types = [e["event_type"] for e in events.json()["items"]]
    assert "login_failed" in types
