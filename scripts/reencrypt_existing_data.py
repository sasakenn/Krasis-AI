#!/usr/bin/env python3
"""
reencrypt_existing_data.py
---------------------------
DATA_ENCRYPTION_KEY(保存データのAES-256-GCM暗号化鍵、crypto_utils参照)を
後から設定・変更したときに一度だけ実行する移行スクリプト。

対象は、平文のまま保存されている可能性がある列:
  - generations.outline_json      (生成したアウトライン本文)
  - history_entries.payload_json  (logic-guide/task-generator/study-notes/tasksの履歴本文)
  - mfa_enrollments.secret        (認証アプリ用のTOTPシークレット)

crypto_utils.decrypt_text()は「enc:v1:/enc:v2: 接頭辞が無い行はそのまま返す」
設計になっているため、鍵を設定しただけでは既存の平文行は暗号化されないままになる。
このスクリプトは各行を読み、まだ暗号化されていなければ現在のDATA_ENCRYPTION_KEYで
暗号化して書き戻す(既に暗号化済みの行はスキップするので、何度実行しても安全)。

使い方:
    DATA_ENCRYPTION_KEY=... ./venv/bin/python scripts/reencrypt_existing_data.py
"""

from __future__ import annotations

import os
import sqlite3
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import crypto_utils  # noqa: E402
from db import DB_PATH  # noqa: E402

_ENC_PREFIXES = ("enc:v1:", "enc:v2:")


def _is_already_encrypted(value: str) -> bool:
    return value.startswith(_ENC_PREFIXES)


def _reencrypt_column(conn: sqlite3.Connection, table: str, id_column: str, value_column: str) -> int:
    rows = conn.execute(f"SELECT {id_column}, {value_column} FROM {table}").fetchall()
    updated = 0
    for row_id, value in rows:
        if value is None or _is_already_encrypted(value):
            continue
        encrypted = crypto_utils.encrypt_text(value)
        conn.execute(
            f"UPDATE {table} SET {value_column} = ? WHERE {id_column} = ?",
            (encrypted, row_id),
        )
        updated += 1
    return updated


def main() -> None:
    if not crypto_utils.is_configured():
        print(
            "DATA_ENCRYPTION_KEYが設定されていません。まず.env(またはRenderの環境変数)に"
            "設定してから実行してください。",
            file=sys.stderr,
        )
        sys.exit(1)

    print(f"DB: {DB_PATH}")
    with sqlite3.connect(DB_PATH) as conn:
        gen_count = _reencrypt_column(conn, "generations", "id", "outline_json")
        history_count = _reencrypt_column(conn, "history_entries", "id", "payload_json")
        mfa_count = _reencrypt_column(conn, "mfa_enrollments", "user_id", "secret")
        conn.commit()

    print(f"generations.outline_json     : {gen_count}件を暗号化しました")
    print(f"history_entries.payload_json : {history_count}件を暗号化しました")
    print(f"mfa_enrollments.secret       : {mfa_count}件を暗号化しました")
    print("完了しました。")


if __name__ == "__main__":
    main()
