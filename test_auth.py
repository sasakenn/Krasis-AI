import time
from unittest.mock import patch

import jwt
import pytest
import requests

import auth
from conftest import sign_oidc_token


class _FakeSigningKey:
    def __init__(self, key):
        self.key = key


class _FakeJWKSClient:
    def __init__(self, public_key):
        self._public_key = public_key

    def get_signing_key_from_jwt(self, token):
        return _FakeSigningKey(self._public_key)


def _use_fake_jwks(monkeypatch, public_key):
    monkeypatch.setattr(auth, "_get_jwks_client", lambda jwks_url: _FakeJWKSClient(public_key))


# --- Apple ---


def test_verify_apple_identity_token_accepts_valid_token(monkeypatch, oidc_keypair):
    private_key, public_key = oidc_keypair
    _use_fake_jwks(monkeypatch, public_key)

    token = sign_oidc_token(private_key)
    claims = auth.verify_apple_identity_token(token)

    assert claims["sub"] == "apple-user-123"
    assert claims["email"] == "user@example.com"


def test_verify_apple_identity_token_rejects_wrong_audience(monkeypatch, oidc_keypair):
    private_key, public_key = oidc_keypair
    _use_fake_jwks(monkeypatch, public_key)

    token = sign_oidc_token(private_key, aud="someone-elses-app")
    with pytest.raises(auth.AuthError):
        auth.verify_apple_identity_token(token)


def test_verify_apple_identity_token_rejects_wrong_issuer(monkeypatch, oidc_keypair):
    private_key, public_key = oidc_keypair
    _use_fake_jwks(monkeypatch, public_key)

    token = sign_oidc_token(private_key, iss="https://evil.example.com")
    with pytest.raises(auth.AuthError):
        auth.verify_apple_identity_token(token)


def test_verify_apple_identity_token_rejects_expired_token(monkeypatch, oidc_keypair):
    private_key, public_key = oidc_keypair
    _use_fake_jwks(monkeypatch, public_key)

    now = int(time.time())
    token = sign_oidc_token(private_key, iat=now - 7200, exp=now - 3600)
    with pytest.raises(auth.AuthError):
        auth.verify_apple_identity_token(token)


def test_verify_apple_identity_token_rejects_token_signed_by_another_key(monkeypatch, oidc_keypair):
    from cryptography.hazmat.primitives.asymmetric import rsa

    private_key, public_key = oidc_keypair
    _use_fake_jwks(monkeypatch, public_key)

    other_private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    token = sign_oidc_token(other_private_key)

    with pytest.raises(auth.AuthError):
        auth.verify_apple_identity_token(token)


def test_verify_apple_identity_token_requires_client_id_configured(monkeypatch):
    monkeypatch.setattr(auth, "APPLE_CLIENT_ID", "")
    with pytest.raises(auth.AuthError):
        auth.verify_apple_identity_token("irrelevant")


def test_verify_apple_identity_token_requires_sub_claim(monkeypatch, oidc_keypair):
    private_key, public_key = oidc_keypair
    _use_fake_jwks(monkeypatch, public_key)

    now = int(time.time())
    claims = {"iss": "https://appleid.apple.com", "aud": "test.apple.client.id", "iat": now, "exp": now + 3600}
    token = jwt.encode(claims, private_key, algorithm="RS256")

    with pytest.raises(auth.AuthError):
        auth.verify_apple_identity_token(token)


# --- Google ---


def test_verify_google_id_token_accepts_valid_token(monkeypatch, oidc_keypair):
    private_key, public_key = oidc_keypair
    _use_fake_jwks(monkeypatch, public_key)

    token = sign_oidc_token(
        private_key,
        iss="https://accounts.google.com",
        aud="test.google.client.id",
        sub="google-user-789",
        email="googler@example.com",
    )
    claims = auth.verify_google_id_token(token)

    assert claims == {"sub": "google-user-789", "email": "googler@example.com"}


def test_verify_google_id_token_accepts_alternate_issuer_form(monkeypatch, oidc_keypair):
    # Googleはissが "accounts.google.com"(https://なし)の場合もあるとドキュメントされている。
    private_key, public_key = oidc_keypair
    _use_fake_jwks(monkeypatch, public_key)

    token = sign_oidc_token(
        private_key, iss="accounts.google.com", aud="test.google.client.id", sub="google-user-789"
    )
    claims = auth.verify_google_id_token(token)
    assert claims["sub"] == "google-user-789"


def test_verify_google_id_token_rejects_wrong_audience(monkeypatch, oidc_keypair):
    private_key, public_key = oidc_keypair
    _use_fake_jwks(monkeypatch, public_key)

    token = sign_oidc_token(
        private_key, iss="https://accounts.google.com", aud="someone-elses-app", sub="google-user-789"
    )
    with pytest.raises(auth.AuthError):
        auth.verify_google_id_token(token)


def test_verify_google_id_token_requires_client_id_configured(monkeypatch):
    monkeypatch.setattr(auth, "GOOGLE_CLIENT_ID", "")
    with pytest.raises(auth.AuthError):
        auth.verify_google_id_token("irrelevant")


# --- GitHub ---


class _FakeResponse:
    def __init__(self, json_data, ok=True, status_code=200):
        self._json_data = json_data
        self.ok = ok
        self.status_code = status_code

    def json(self):
        return self._json_data

    def raise_for_status(self):
        if not self.ok:
            raise requests.HTTPError("bad status")


def test_exchange_github_code_for_user_success(monkeypatch):
    def fake_post(url, data=None, headers=None, timeout=None):
        assert url == auth.GITHUB_TOKEN_URL
        assert data["code"] == "the-code"
        return _FakeResponse({"access_token": "gho_faketoken"})

    def fake_get(url, headers=None, timeout=None):
        if url == auth.GITHUB_USER_URL:
            return _FakeResponse({"id": 42, "email": None})
        if url == auth.GITHUB_USER_EMAILS_URL:
            return _FakeResponse([{"email": "octocat@example.com", "primary": True, "verified": True}])
        raise AssertionError(f"unexpected URL {url}")

    with patch("auth.requests.post", side_effect=fake_post), patch("auth.requests.get", side_effect=fake_get):
        result = auth.exchange_github_code_for_user("the-code")

    assert result == {"sub": "42", "email": "octocat@example.com"}


def test_exchange_github_code_for_user_uses_public_email_when_present(monkeypatch):
    def fake_post(url, data=None, headers=None, timeout=None):
        return _FakeResponse({"access_token": "gho_faketoken"})

    def fake_get(url, headers=None, timeout=None):
        assert url == auth.GITHUB_USER_URL
        return _FakeResponse({"id": 7, "email": "public@example.com"})

    with patch("auth.requests.post", side_effect=fake_post), patch("auth.requests.get", side_effect=fake_get):
        result = auth.exchange_github_code_for_user("the-code")

    assert result == {"sub": "7", "email": "public@example.com"}


def test_exchange_github_code_for_user_requires_client_credentials(monkeypatch):
    monkeypatch.setattr(auth, "GITHUB_CLIENT_ID", "")
    with pytest.raises(auth.AuthError):
        auth.exchange_github_code_for_user("irrelevant")


def test_exchange_github_code_for_user_raises_when_no_access_token(monkeypatch):
    def fake_post(url, data=None, headers=None, timeout=None):
        return _FakeResponse({"error": "bad_verification_code"})

    with patch("auth.requests.post", side_effect=fake_post):
        with pytest.raises(auth.AuthError):
            auth.exchange_github_code_for_user("bad-code")


# --- アプリ独自セッションJWT ---


def test_create_and_decode_app_token_roundtrip():
    token = auth.create_app_token("user-42")
    assert auth.decode_app_token(token) == "user-42"


def test_decode_app_token_rejects_tampered_token():
    token = auth.create_app_token("user-42")
    tampered = token[:-1] + ("A" if token[-1] != "A" else "B")
    with pytest.raises(auth.AuthError):
        auth.decode_app_token(tampered)


def test_decode_app_token_requires_secret_configured(monkeypatch):
    monkeypatch.setattr(auth, "JWT_SECRET", "")
    with pytest.raises(auth.AuthError):
        auth.decode_app_token("irrelevant")


def test_create_app_token_requires_secret_configured(monkeypatch):
    monkeypatch.setattr(auth, "JWT_SECRET", "")
    with pytest.raises(auth.AuthError):
        auth.create_app_token("user-42")
