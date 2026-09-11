"""
auth.py
-------
Sign in with Apple の identity token を検証し、アプリ独自のセッションJWTを
発行・検証するモジュール。

Appleが発行する identity token(RS256署名のJWT)を Apple の公開鍵で検証し、
以後のAPIリクエストでは(Appleにアクセスしなくて済むように)アプリ独自に
発行した短命のJWT(HS256、JWT_SECRETで署名)をBearerトークンとして使う。
"""

from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone

import jwt
import requests
from dotenv import load_dotenv
from jwt import PyJWKClient

load_dotenv()

APPLE_ISSUER = "https://appleid.apple.com"
APPLE_JWKS_URL = "https://appleid.apple.com/auth/keys"

# Sign in with Apple のServices ID(または対象のBundle ID)。identity tokenの
# audクレームと一致することを要求する。Apple Developer Program登録後に取得する。
APPLE_CLIENT_ID = os.getenv("APPLE_CLIENT_ID", "").strip()

# アプリ独自セッションJWTの署名鍵。本番では必ず長いランダム値を設定すること。
JWT_SECRET = os.getenv("JWT_SECRET", "").strip()
APP_TOKEN_TTL = timedelta(days=30)

# AppleのJWKS(公開鍵一式)は頻繁には変わらないため、PyJWKClientの内蔵キャッシュに任せる
# (デフォルトで直近のレスポンスをプロセス内にキャッシュする)。
_jwks_client: PyJWKClient | None = None


def _get_jwks_client() -> PyJWKClient:
    global _jwks_client
    if _jwks_client is None:
        _jwks_client = PyJWKClient(APPLE_JWKS_URL)
    return _jwks_client


class AuthError(Exception):
    """identity token / アプリセッショントークンの検証に失敗したことを表す。"""


def verify_apple_identity_token(identity_token: str) -> dict:
    """Sign in with Apple の identity token を検証し、claims(sub, emailなど)を返す。"""
    if not APPLE_CLIENT_ID:
        raise AuthError("APPLE_CLIENT_ID is not configured on the server")

    try:
        signing_key = _get_jwks_client().get_signing_key_from_jwt(identity_token)
        claims = jwt.decode(
            identity_token,
            signing_key.key,
            algorithms=["RS256"],
            audience=APPLE_CLIENT_ID,
            issuer=APPLE_ISSUER,
        )
    except jwt.PyJWTError as exc:
        raise AuthError(f"invalid Apple identity token: {exc}") from exc
    except requests.RequestException as exc:
        raise AuthError(f"failed to fetch Apple's signing keys: {exc}") from exc

    if not claims.get("sub"):
        raise AuthError("Apple identity token is missing 'sub' claim")

    return claims


def create_app_token(user_id: str) -> str:
    """検証済みユーザー向けに、以後のAPIリクエストで使うアプリ独自のセッションJWTを発行する。"""
    if not JWT_SECRET:
        raise AuthError("JWT_SECRET is not configured on the server")

    now = datetime.now(timezone.utc)
    payload = {
        "sub": user_id,
        "iat": int(now.timestamp()),
        "exp": int((now + APP_TOKEN_TTL).timestamp()),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm="HS256")


def decode_app_token(token: str) -> str:
    """アプリ独自のセッションJWTを検証し、user_idを返す。失敗時はAuthErrorを送出する。"""
    if not JWT_SECRET:
        raise AuthError("JWT_SECRET is not configured on the server")

    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
    except jwt.PyJWTError as exc:
        raise AuthError(f"invalid session token: {exc}") from exc

    user_id = payload.get("sub")
    if not user_id:
        raise AuthError("session token is missing 'sub' claim")
    return user_id
