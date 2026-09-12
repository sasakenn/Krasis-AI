"""
auth.py
-------
Apple / Google / GitHub でのログインを検証し、アプリ独自のセッションJWTを
発行・検証するモジュール。

Apple・Googleは「identity token」(RS256署名のJWT、OIDC)を各社の公開鍵で検証する。
GitHubはOIDCではなく普通のOAuth2なので、認可コードをアクセストークンに交換し、
GitHubのAPIからプロフィールを取得する。

いずれの方式で検証できても、以後のAPIリクエストでは(各社に毎回アクセスしなくて
済むように)アプリ独自に発行した短命のJWT(HS256、JWT_SECRETで署名)をBearer
トークンとして使う。
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
GOOGLE_ISSUERS = ("https://accounts.google.com", "accounts.google.com")
GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs"
GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token"
GITHUB_USER_URL = "https://api.github.com/user"
GITHUB_USER_EMAILS_URL = "https://api.github.com/user/emails"

# Sign in with Apple のServices ID(または対象のBundle ID)。identity tokenの
# audクレームと一致することを要求する。Apple Developer Program登録後に取得する。
APPLE_CLIENT_ID = os.getenv("APPLE_CLIENT_ID", "").strip()

# Google OAuthクライアントID(Google Cloud ConsoleでOAuth同意画面設定後に取得)。
GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "").strip()

# GitHub OAuth App の Client ID / Secret(GitHubのDeveloper settingsで作成)。
GITHUB_CLIENT_ID = os.getenv("GITHUB_CLIENT_ID", "").strip()
GITHUB_CLIENT_SECRET = os.getenv("GITHUB_CLIENT_SECRET", "").strip()

# アプリ独自セッションJWTの署名鍵。本番では必ず長いランダム値を設定すること。
JWT_SECRET = os.getenv("JWT_SECRET", "").strip()
APP_TOKEN_TTL = timedelta(days=30)

# 各社のJWKS(公開鍵一式)はJWKS URLごとにPyJWKClientをキャッシュする
# (PyJWKClient自体も直近のレスポンスをプロセス内にキャッシュする)。
_jwks_clients: dict[str, PyJWKClient] = {}


def _get_jwks_client(jwks_url: str) -> PyJWKClient:
    client = _jwks_clients.get(jwks_url)
    if client is None:
        client = PyJWKClient(jwks_url)
        _jwks_clients[jwks_url] = client
    return client


class AuthError(Exception):
    """ログイン検証 / アプリセッショントークンの検証に失敗したことを表す。"""


def _verify_oidc_id_token(token: str, *, issuer, audience: str, jwks_url: str) -> dict:
    """OIDCのidentity token(Apple/Google共通の形)を検証し、claimsを返す。

    issuer は文字列1つ、または許容する複数issuerのタプルを受け付ける。
    """
    try:
        signing_key = _get_jwks_client(jwks_url).get_signing_key_from_jwt(token)
        claims = jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256"],
            audience=audience,
            issuer=issuer if isinstance(issuer, str) else list(issuer),
        )
    except jwt.PyJWTError as exc:
        raise AuthError(f"invalid identity token: {exc}") from exc
    except requests.RequestException as exc:
        raise AuthError(f"failed to fetch signing keys: {exc}") from exc

    if not claims.get("sub"):
        raise AuthError("identity token is missing 'sub' claim")

    return claims


def verify_apple_identity_token(identity_token: str) -> dict:
    """Sign in with Apple の identity token を検証し、{"sub", "email"}を返す。"""
    if not APPLE_CLIENT_ID:
        raise AuthError("APPLE_CLIENT_ID is not configured on the server")

    claims = _verify_oidc_id_token(
        identity_token, issuer=APPLE_ISSUER, audience=APPLE_CLIENT_ID, jwks_url=APPLE_JWKS_URL
    )
    return {"sub": claims["sub"], "email": claims.get("email")}


def verify_google_id_token(id_token: str) -> dict:
    """Googleサインインの id_token を検証し、{"sub", "email"}を返す。"""
    if not GOOGLE_CLIENT_ID:
        raise AuthError("GOOGLE_CLIENT_ID is not configured on the server")

    claims = _verify_oidc_id_token(
        id_token, issuer=GOOGLE_ISSUERS, audience=GOOGLE_CLIENT_ID, jwks_url=GOOGLE_JWKS_URL
    )
    return {"sub": claims["sub"], "email": claims.get("email")}


def exchange_github_code_for_user(code: str) -> dict:
    """GitHub OAuthの認可コードをアクセストークンに交換し、プロフィールを取得する。

    GitHubはOIDCではない(identity tokenを発行しない)ため、サーバー側で
    アクセストークンに交換してAPIを呼ぶ、通常のOAuth2フローになる。
    """
    if not GITHUB_CLIENT_ID or not GITHUB_CLIENT_SECRET:
        raise AuthError("GITHUB_CLIENT_ID/GITHUB_CLIENT_SECRET is not configured on the server")

    try:
        token_resp = requests.post(
            GITHUB_TOKEN_URL,
            data={
                "client_id": GITHUB_CLIENT_ID,
                "client_secret": GITHUB_CLIENT_SECRET,
                "code": code,
            },
            headers={"Accept": "application/json"},
            timeout=10,
        )
        token_resp.raise_for_status()
        token_data = token_resp.json()
        access_token = token_data.get("access_token")
        if not access_token:
            raise AuthError(f"GitHub did not return an access token: {token_data}")

        auth_headers = {"Authorization": f"Bearer {access_token}", "Accept": "application/json"}
        user_resp = requests.get(GITHUB_USER_URL, headers=auth_headers, timeout=10)
        user_resp.raise_for_status()
        user_data = user_resp.json()

        email = user_data.get("email")
        if not email:
            emails_resp = requests.get(GITHUB_USER_EMAILS_URL, headers=auth_headers, timeout=10)
            if emails_resp.ok:
                primary = next(
                    (e for e in emails_resp.json() if e.get("primary") and e.get("verified")), None
                )
                email = primary["email"] if primary else None
    except requests.RequestException as exc:
        raise AuthError(f"GitHub sign-in failed: {exc}") from exc

    github_user_id = user_data.get("id")
    if not github_user_id:
        raise AuthError("GitHub profile response is missing 'id'")

    return {"sub": str(github_user_id), "email": email}


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
