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
# common = 個人/組織どちらのMicrosoftアカウントでもログインできるマルチテナントエンドポイント。
MICROSOFT_TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token"
MICROSOFT_GRAPH_ME_URL = "https://graph.microsoft.com/v1.0/me"

# Sign in with Apple のServices ID(または対象のBundle ID)。identity tokenの
# audクレームと一致することを要求する。Apple Developer Program登録後に取得する。
APPLE_CLIENT_ID = os.getenv("APPLE_CLIENT_ID", "").strip()

# Google OAuthクライアントID(Google Cloud ConsoleでOAuth同意画面設定後に取得)。
GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "").strip()

# GitHub OAuth App の Client ID / Secret(GitHubのDeveloper settingsで作成)。
GITHUB_CLIENT_ID = os.getenv("GITHUB_CLIENT_ID", "").strip()
GITHUB_CLIENT_SECRET = os.getenv("GITHUB_CLIENT_SECRET", "").strip()

# Microsoft(Azure ADアプリ登録)の Client ID / Secret。Azure Portal → 「アプリの登録」で
# 作成する(登録自体は無料。Apple Developer Programのような有料登録は不要)。
MICROSOFT_CLIENT_ID = os.getenv("MICROSOFT_CLIENT_ID", "").strip()
MICROSOFT_CLIENT_SECRET = os.getenv("MICROSOFT_CLIENT_SECRET", "").strip()

# アプリ独自セッションJWTの署名鍵。本番では必ず長いランダム値を設定すること
# (`python -c "import secrets; print(secrets.token_hex(32))"` 等で生成)。
JWT_SECRET = os.getenv("JWT_SECRET", "").strip()
APP_TOKEN_TTL = timedelta(days=30)

# HS256は総当たり攻撃への耐性が鍵の長さに直結するため、設定されている場合は
# 最低長を強制する(短すぎる鍵のまま気づかず本番稼働することを防ぐ、起動時フェイルファスト)。
_MIN_JWT_SECRET_LENGTH = 32
if JWT_SECRET and len(JWT_SECRET) < _MIN_JWT_SECRET_LENGTH:
    raise RuntimeError(
        f"JWT_SECRET は最低{_MIN_JWT_SECRET_LENGTH}文字必要です(現在{len(JWT_SECRET)}文字)。"
        "総当たり攻撃に耐えられる、十分に長いランダム値を設定してください。"
    )

# MFA(認証アプリのコード)入力待ちの間だけ有効な、短命の「仮認証」トークンの有効期限。
MFA_TOKEN_TTL = timedelta(minutes=5)
MFA_TOKEN_PURPOSE = "mfa"

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


def exchange_microsoft_code_for_user(code: str, redirect_uri: str) -> dict:
    """MicrosoftのOAuth2認可コードをアクセストークンに交換し、Graph APIでプロフィールを取得する。

    GitHubと同じ通常のOAuth2(認可コード)フローだが、Microsoftはトークン交換時に
    認可リクエストで使ったredirect_uriと完全一致する値を要求するため、引数で受け取る。
    """
    if not MICROSOFT_CLIENT_ID or not MICROSOFT_CLIENT_SECRET:
        raise AuthError("MICROSOFT_CLIENT_ID/MICROSOFT_CLIENT_SECRET is not configured on the server")

    try:
        token_resp = requests.post(
            MICROSOFT_TOKEN_URL,
            data={
                "client_id": MICROSOFT_CLIENT_ID,
                "client_secret": MICROSOFT_CLIENT_SECRET,
                "code": code,
                "redirect_uri": redirect_uri,
                "grant_type": "authorization_code",
                "scope": "openid profile email User.Read",
            },
            headers={"Accept": "application/json"},
            timeout=10,
        )
        token_resp.raise_for_status()
        token_data = token_resp.json()
        access_token = token_data.get("access_token")
        if not access_token:
            raise AuthError(f"Microsoft did not return an access token: {token_data}")

        user_resp = requests.get(
            MICROSOFT_GRAPH_ME_URL,
            headers={"Authorization": f"Bearer {access_token}", "Accept": "application/json"},
            timeout=10,
        )
        user_resp.raise_for_status()
        user_data = user_resp.json()
    except requests.RequestException as exc:
        raise AuthError(f"Microsoft sign-in failed: {exc}") from exc

    microsoft_user_id = user_data.get("id")
    if not microsoft_user_id:
        raise AuthError("Microsoft profile response is missing 'id'")

    email = user_data.get("mail") or user_data.get("userPrincipalName")
    return {"sub": microsoft_user_id, "email": email}


def create_app_token(user_id: str, token_version: int = 0) -> str:
    """検証済みユーザー向けに、以後のAPIリクエストで使うアプリ独自のセッションJWTを発行する。

    token_versionはdb.get_token_version()の値をそのまま埋め込む(呼び出し元=app.py側で
    渡す)。ユーザーのtoken_versionが後から変わった(ログアウト全端末・MFA変更)場合、
    このJWT自体は有効期限内でも古いバージョンのまま使えなくなる(decode_app_token参照)。
    """
    if not JWT_SECRET:
        raise AuthError("JWT_SECRET is not configured on the server")

    now = datetime.now(timezone.utc)
    payload = {
        "sub": user_id,
        "ver": token_version,
        "iat": int(now.timestamp()),
        "exp": int((now + APP_TOKEN_TTL).timestamp()),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm="HS256")


def decode_app_token(token: str) -> tuple[str, int]:
    """アプリ独自のセッションJWTを検証し、(user_id, token_version)を返す。

    token_versionは呼び出し元がdb.get_token_version(user_id)と突き合わせて、
    一括失効(ログアウト・MFA変更)後の古いトークンを拒否するために使う
    (このモジュール自体はDBを参照しないので、突き合わせ自体は行わない)。
    失敗時はAuthErrorを送出する。
    """
    if not JWT_SECRET:
        raise AuthError("JWT_SECRET is not configured on the server")

    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
    except jwt.PyJWTError as exc:
        raise AuthError(f"invalid session token: {exc}") from exc

    user_id = payload.get("sub")
    if not user_id:
        raise AuthError("session token is missing 'sub' claim")
    # MFA入力待ちの仮認証トークンをセッショントークンとして使われないようにする。
    if payload.get("purpose"):
        raise AuthError("token is not a session token")
    # 旧バージョン(verクレーム導入前)に発行されたトークンはver=0として扱う。
    return user_id, int(payload.get("ver", 0))


def create_mfa_token(user_id: str) -> str:
    """ログインコードは正しいがMFAの確認が残っている状態を表す、短命の仮認証トークンを発行する。"""
    if not JWT_SECRET:
        raise AuthError("JWT_SECRET is not configured on the server")

    now = datetime.now(timezone.utc)
    payload = {
        "sub": user_id,
        "purpose": MFA_TOKEN_PURPOSE,
        "iat": int(now.timestamp()),
        "exp": int((now + MFA_TOKEN_TTL).timestamp()),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm="HS256")


def decode_mfa_token(token: str) -> str:
    """仮認証トークンを検証し、user_idを返す。セッショントークン等の別用途のJWTは受け付けない。"""
    if not JWT_SECRET:
        raise AuthError("JWT_SECRET is not configured on the server")

    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
    except jwt.PyJWTError as exc:
        raise AuthError(f"invalid mfa token: {exc}") from exc

    if payload.get("purpose") != MFA_TOKEN_PURPOSE or not payload.get("sub"):
        raise AuthError("token is not an mfa token")
    return payload["sub"]
