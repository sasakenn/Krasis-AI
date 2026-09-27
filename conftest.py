import os
import tempfile
import time

import pytest

# db.py が読み込まれる前に DB_PATH を一時ファイルへ差し替え、
# テストが本番用の data/app.db を汚さないようにする。
os.environ.setdefault("DB_PATH", os.path.join(tempfile.mkdtemp(), "test.db"))

# 開発者のローカル .env の値に依存せず、常に同じ挙動でテストできるようにする。
# setdefault なので、既にos.environにセットされていれば上書きしない
# (python-dotenvのload_dotenvもデフォルトでは既存の環境変数を上書きしないため、
# ここで先に設定しておけば .env の値より優先される)。
DEFAULT_TEST_USER_ID = "conftest-default-test-user"
os.environ.setdefault("DEV_BYPASS_USER_ID", DEFAULT_TEST_USER_ID)
os.environ.setdefault("ADMIN_USER_IDS", DEFAULT_TEST_USER_ID)
os.environ.setdefault("JWT_SECRET", "test-only-secret-do-not-use-in-production")
os.environ.setdefault("APPLE_CLIENT_ID", "test.apple.client.id")
os.environ.setdefault("GOOGLE_CLIENT_ID", "test.google.client.id")
os.environ.setdefault("GITHUB_CLIENT_ID", "test-github-client-id")
os.environ.setdefault("GITHUB_CLIENT_SECRET", "test-github-client-secret")


@pytest.fixture(autouse=True)
def _reset_generate_rate_limit_state():
    """/generate のレート制限状態はモジュールグローバルなので、テスト間で共有されて
    後続のテストが誤って429になるのを防ぐため、各テストの前後でリセットする。"""
    import app as app_module

    app_module._rate_limit_state = {}
    app_module._login_failure_state = {}
    yield
    app_module._rate_limit_state = {}
    app_module._login_failure_state = {}


@pytest.fixture
def oidc_keypair():
    """Apple/GoogleのOIDC identity token検証をネットワークなしでテストするための
    使い捨てRSA鍵ペア(本物の鍵とは無関係、テスト専用)。"""
    from cryptography.hazmat.primitives.asymmetric import rsa

    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    return private_key, private_key.public_key()


def sign_oidc_token(private_key, **claim_overrides) -> str:
    """oidc_keypairの秘密鍵で、Appleのidentity token相当のJWTを組み立てて署名する。

    デフォルトはApple向けのclaims。Google等をテストする場合はiss/aud/subを上書きする。
    """
    import jwt

    now = int(time.time())
    claims = {
        "iss": "https://appleid.apple.com",
        "aud": "test.apple.client.id",
        "sub": "apple-user-123",
        "email": "user@example.com",
        "iat": now,
        "exp": now + 3600,
    }
    claims.update(claim_overrides)
    return jwt.encode(claims, private_key, algorithm="RS256")
