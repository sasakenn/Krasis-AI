"""
crypto_utils.py
---------------
保存データ(生成内容・MFAシークレット等)をアプリ層で暗号化するための最小限のヘルパー。

保存時暗号化(encryption at rest)は AES-256-GCM(認証付き暗号)を使う。
DATA_ENCRYPTION_KEY(`python -c "from cryptography.fernet import Fernet;
print(Fernet.generate_key().decode())"` で生成する、base64エンコードされた32バイト=256bitの鍵)
が設定されていれば暗号化して保存し、未設定なら平文のまま保存する
(ローカル開発で鍵管理を必須にしないため。本番ではDATA_ENCRYPTION_KEY必須。app.py起動時チェック参照)。

暗号化済みの値には接頭辞を付けるので、鍵を後から設定しても、それ以前に平文で
保存された行はそのまま読める(段階的な移行ができる)。

過去バージョン(enc:v1:, Fernet=AES-128-CBC+HMAC-SHA256)で暗号化された行は、
同じDATA_ENCRYPTION_KEYであれば引き続き復号できる(Fernet鍵もbase64の32バイトなので、
鍵を再発行・再設定する必要はない)。新規の暗号化は常にenc:v2:(AES-256-GCM)を使う。
"""

from __future__ import annotations

import base64
import logging
import os

from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

_PREFIX_V1 = "enc:v1:"  # レガシー: Fernet (AES-128-CBC + HMAC-SHA256)。復号のみ引き続きサポート。
_PREFIX_V2 = "enc:v2:"  # 現行: AES-256-GCM(認証付き暗号)。新規の暗号化は常にこちら。
_GCM_NONCE_BYTES = 12  # AES-GCMで推奨される96bitノンス

DATA_ENCRYPTION_KEY = os.getenv("DATA_ENCRYPTION_KEY", "").strip()

_aesgcm: AESGCM | None = None
_legacy_fernet: Fernet | None = None

if DATA_ENCRYPTION_KEY:
    try:
        _raw_key = base64.urlsafe_b64decode(DATA_ENCRYPTION_KEY.encode("utf-8"))
        if len(_raw_key) != 32:
            raise ValueError(f"decoded key is {len(_raw_key)} bytes, expected 32 (AES-256)")
        _aesgcm = AESGCM(_raw_key)
        # 同じ鍵材料(base64の32バイト)をFernetとしても解釈できるので、過去にenc:v1:で
        # 保存された行の復号にも同じDATA_ENCRYPTION_KEYがそのまま使える。
        _legacy_fernet = Fernet(DATA_ENCRYPTION_KEY.encode("utf-8"))
    except (ValueError, TypeError) as exc:
        raise RuntimeError(
            "DATA_ENCRYPTION_KEY の形式が不正です"
            "(base64エンコードされた32バイト=256bitの鍵である必要があります)"
        ) from exc
else:
    logger.warning("DATA_ENCRYPTION_KEY未設定のため、保存データは暗号化されずに平文で保存されます")


def is_configured() -> bool:
    return _aesgcm is not None


def generate_key() -> str:
    """AES-256-GCM用の鍵(base64エンコードされた32バイトの乱数)を新規生成する。

    Fernet.generate_key()はos.urandom(32)をbase64url化するだけなので、そのまま
    AES-256の生鍵としても使える(このモジュール独自の鍵形式を増やさないための再利用)。
    """
    return Fernet.generate_key().decode("utf-8")


def encrypt_text(plaintext: str) -> str:
    if _aesgcm is None:
        return plaintext
    nonce = os.urandom(_GCM_NONCE_BYTES)
    ciphertext = _aesgcm.encrypt(nonce, plaintext.encode("utf-8"), None)
    packed = base64.urlsafe_b64encode(nonce + ciphertext).decode("utf-8")
    return _PREFIX_V2 + packed


def decrypt_text(stored: str) -> str:
    """暗号化済み(接頭辞付き)なら復号し、平文で保存された古い行はそのまま返す。"""
    if stored.startswith(_PREFIX_V2):
        if _aesgcm is None:
            raise RuntimeError("暗号化されたデータがありますが DATA_ENCRYPTION_KEY が設定されていません")
        try:
            raw = base64.urlsafe_b64decode(stored[len(_PREFIX_V2):].encode("utf-8"))
            nonce, ciphertext = raw[:_GCM_NONCE_BYTES], raw[_GCM_NONCE_BYTES:]
            return _aesgcm.decrypt(nonce, ciphertext, None).decode("utf-8")
        except Exception as exc:  # cryptography.exceptions.InvalidTag 等
            raise RuntimeError(
                "保存データの復号に失敗しました(DATA_ENCRYPTION_KEYが保存時と異なる可能性があります)"
            ) from exc

    if stored.startswith(_PREFIX_V1):
        if _legacy_fernet is None:
            raise RuntimeError("暗号化されたデータがありますが DATA_ENCRYPTION_KEY が設定されていません")
        try:
            return _legacy_fernet.decrypt(stored[len(_PREFIX_V1):].encode("utf-8")).decode("utf-8")
        except InvalidToken as exc:
            raise RuntimeError(
                "保存データの復号に失敗しました(DATA_ENCRYPTION_KEYが保存時と異なる可能性があります)"
            ) from exc

    return stored
