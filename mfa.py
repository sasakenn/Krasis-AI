"""
mfa.py
------
TOTP(RFC 6238)方式の多要素認証。Google Authenticator / 1Password 等の
認証アプリで使える形式のシークレットを発行し、6桁コードを検証する。
"""

from __future__ import annotations

import pyotp

ISSUER_NAME = "Paper Assistant"


def generate_secret() -> str:
    return pyotp.random_base32()


def provisioning_uri(secret: str, account_name: str) -> str:
    """認証アプリに登録するための otpauth:// URI(QRコード化してもそのまま手入力してもよい)。"""
    return pyotp.TOTP(secret).provisioning_uri(name=account_name, issuer_name=ISSUER_NAME)


def verify_code(secret: str, code: str) -> bool:
    normalized = code.strip().replace(" ", "")
    if len(normalized) != 6 or not normalized.isdigit():
        return False
    # 端末の時計ずれを許容するため前後1ステップ(30秒)まで有効とする。
    return pyotp.TOTP(secret).verify(normalized, valid_window=1)
