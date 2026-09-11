import time

import jwt
import pytest

import auth
from conftest import sign_apple_identity_token


class _FakeSigningKey:
    def __init__(self, key):
        self.key = key


class _FakeJWKSClient:
    def __init__(self, public_key):
        self._public_key = public_key

    def get_signing_key_from_jwt(self, token):
        return _FakeSigningKey(self._public_key)


def _use_fake_apple_keys(monkeypatch, public_key):
    monkeypatch.setattr(auth, "_get_jwks_client", lambda: _FakeJWKSClient(public_key))


def test_verify_apple_identity_token_accepts_valid_token(monkeypatch, apple_keypair):
    private_key, public_key = apple_keypair
    _use_fake_apple_keys(monkeypatch, public_key)

    token = sign_apple_identity_token(private_key)
    claims = auth.verify_apple_identity_token(token)

    assert claims["sub"] == "apple-user-123"
    assert claims["email"] == "user@example.com"


def test_verify_apple_identity_token_rejects_wrong_audience(monkeypatch, apple_keypair):
    private_key, public_key = apple_keypair
    _use_fake_apple_keys(monkeypatch, public_key)

    token = sign_apple_identity_token(private_key, aud="someone-elses-app")
    with pytest.raises(auth.AuthError):
        auth.verify_apple_identity_token(token)


def test_verify_apple_identity_token_rejects_wrong_issuer(monkeypatch, apple_keypair):
    private_key, public_key = apple_keypair
    _use_fake_apple_keys(monkeypatch, public_key)

    token = sign_apple_identity_token(private_key, iss="https://evil.example.com")
    with pytest.raises(auth.AuthError):
        auth.verify_apple_identity_token(token)


def test_verify_apple_identity_token_rejects_expired_token(monkeypatch, apple_keypair):
    private_key, public_key = apple_keypair
    _use_fake_apple_keys(monkeypatch, public_key)

    now = int(time.time())
    token = sign_apple_identity_token(private_key, iat=now - 7200, exp=now - 3600)
    with pytest.raises(auth.AuthError):
        auth.verify_apple_identity_token(token)


def test_verify_apple_identity_token_rejects_token_signed_by_another_key(monkeypatch, apple_keypair):
    from cryptography.hazmat.primitives.asymmetric import rsa

    private_key, public_key = apple_keypair
    _use_fake_apple_keys(monkeypatch, public_key)

    other_private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    token = sign_apple_identity_token(other_private_key)

    with pytest.raises(auth.AuthError):
        auth.verify_apple_identity_token(token)


def test_verify_apple_identity_token_requires_client_id_configured(monkeypatch):
    monkeypatch.setattr(auth, "APPLE_CLIENT_ID", "")
    with pytest.raises(auth.AuthError):
        auth.verify_apple_identity_token("irrelevant")


def test_verify_apple_identity_token_requires_sub_claim(monkeypatch, apple_keypair):
    private_key, public_key = apple_keypair
    _use_fake_apple_keys(monkeypatch, public_key)

    now = int(time.time())
    claims = {"iss": "https://appleid.apple.com", "aud": "test.apple.client.id", "iat": now, "exp": now + 3600}
    token = jwt.encode(claims, private_key, algorithm="RS256")

    with pytest.raises(auth.AuthError):
        auth.verify_apple_identity_token(token)


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
