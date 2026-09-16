"""
crypto_utils.py
---------------
保存データ(生成内容・MFAシークレット等)をアプリ層で暗号化するための最小限のヘルパー。

DATA_ENCRYPTION_KEY(Fernet鍵、`python -c "from cryptography.fernet import Fernet;
print(Fernet.generate_key().decode())"` で生成)が設定されていれば暗号化して保存し、
未設定なら平文のまま保存する(ローカル開発で鍵管理を必須にしないため)。

暗号化済みの値には接頭辞を付けるので、鍵を後から設定しても、それ以前に平文で
保存された行はそのまま読める(段階的な移行ができる)。
"""

from __future__ import annotations

import logging
import os

from cryptography.fernet import Fernet, InvalidToken
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

_PREFIX = "enc:v1:"

DATA_ENCRYPTION_KEY = os.getenv("DATA_ENCRYPTION_KEY", "").strip()

if DATA_ENCRYPTION_KEY:
    try:
        _fernet: Fernet | None = Fernet(DATA_ENCRYPTION_KEY.encode("utf-8"))
    except (ValueError, TypeError) as exc:
        raise RuntimeError(
            "DATA_ENCRYPTION_KEY の形式が不正です(Fernet鍵はbase64エンコードされた32バイトである必要があります)"
        ) from exc
else:
    _fernet = None
    logger.warning("DATA_ENCRYPTION_KEY未設定のため、保存データは暗号化されずに平文で保存されます")


def is_configured() -> bool:
    return _fernet is not None


def generate_key() -> str:
    return Fernet.generate_key().decode("utf-8")


def encrypt_text(plaintext: str) -> str:
    if _fernet is None:
        return plaintext
    return _PREFIX + _fernet.encrypt(plaintext.encode("utf-8")).decode("utf-8")


def decrypt_text(stored: str) -> str:
    """暗号化済み(接頭辞付き)なら復号し、平文で保存された古い行はそのまま返す。"""
    if not stored.startswith(_PREFIX):
        return stored
    if _fernet is None:
        raise RuntimeError("暗号化されたデータがありますが DATA_ENCRYPTION_KEY が設定されていません")
    try:
        return _fernet.decrypt(stored[len(_PREFIX):].encode("utf-8")).decode("utf-8")
    except InvalidToken as exc:
        raise RuntimeError("保存データの復号に失敗しました(DATA_ENCRYPTION_KEYが保存時と異なる可能性があります)") from exc
