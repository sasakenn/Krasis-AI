"""
db.py
-----
生成したアウトラインの履歴・タブ(セッション)・ユーザー・利用量(トークン)を
SQLiteに保存・参照するモジュール。

サーバーローカルの単一ファイルDB(SQLite)で十分な規模のアプリのため、
外部DBサーバーやORMは使わず標準ライブラリの sqlite3 のみで完結させる。
"""

from __future__ import annotations

import json
import os
import sqlite3
from datetime import datetime, timezone

DB_PATH = os.getenv("DB_PATH", os.path.join(os.path.dirname(__file__), "data", "app.db"))

# マルチユーザー化(user_id列の追加)より前に作られた行の所有者として使う固定ID。
LEGACY_USER_ID = "legacy-local-user"

DEFAULT_PLAN = "free"


def _connect() -> sqlite3.Connection:
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def _ensure_column(conn: sqlite3.Connection, table: str, column: str, ddl_type: str, backfill=None) -> None:
    """指定列の追加前に作られたDBファイル向けの簡易マイグレーション。

    backfillを渡すと、既存行のNULLをその値で埋める(データを消さずに済ませる)。
    """
    columns = {row["name"] for row in conn.execute(f"PRAGMA table_info({table})").fetchall()}
    if column in columns:
        return
    conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {ddl_type}")
    if backfill is not None:
        conn.execute(f"UPDATE {table} SET {column} = ? WHERE {column} IS NULL", (backfill,))


def init_db() -> None:
    with _connect() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                email TEXT,
                created_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS generations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL,
                created_at TEXT NOT NULL,
                topic TEXT NOT NULL,
                field TEXT NOT NULL,
                target_length TEXT,
                title TEXT NOT NULL,
                outline_json TEXT NOT NULL,
                is_private INTEGER NOT NULL DEFAULT 0
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL,
                title TEXT NOT NULL,
                messages_json TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS entitlements (
                user_id TEXT PRIMARY KEY,
                plan TEXT NOT NULL DEFAULT 'free',
                tokens_used INTEGER NOT NULL DEFAULT 0,
                period_start TEXT NOT NULL,
                stripe_customer_id TEXT
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS code_logins (
                user_id TEXT PRIMARY KEY,
                email TEXT NOT NULL UNIQUE,
                code_hash TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
            """
        )

        # 列追加前のDBファイルを引き続き使えるようにする簡易マイグレーション。
        _ensure_column(conn, "generations", "user_id", "TEXT", backfill=LEGACY_USER_ID)
        _ensure_column(conn, "sessions", "user_id", "TEXT", backfill=LEGACY_USER_ID)
        _ensure_column(conn, "generations", "is_private", "INTEGER", backfill=0)
        _ensure_column(conn, "entitlements", "stripe_customer_id", "TEXT")
        conn.execute(
            "INSERT OR IGNORE INTO users (id, email, created_at) VALUES (?, NULL, ?)",
            (LEGACY_USER_ID, datetime.now(timezone.utc).isoformat()),
        )


def upsert_user(user_id: str, email: str | None) -> None:
    with _connect() as conn:
        existing = conn.execute("SELECT id FROM users WHERE id = ?", (user_id,)).fetchone()
        if existing is None:
            conn.execute(
                "INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)",
                (user_id, email, datetime.now(timezone.utc).isoformat()),
            )
        elif email:
            # 各プロバイダーがメールアドレスを返すのは初回サインイン時のみのことが多いので、
            # 渡ってきた場合だけ上書きする(以降のサインインでNoneに戻さないため)。
            conn.execute("UPDATE users SET email = ? WHERE id = ?", (email, user_id))


def save_generation(
    user_id: str,
    topic: str,
    field: str,
    target_length: str,
    outline: dict,
    is_private: bool = False,
) -> int:
    with _connect() as conn:
        cursor = conn.execute(
            """
            INSERT INTO generations
                (user_id, created_at, topic, field, target_length, title, outline_json, is_private)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                user_id,
                datetime.now(timezone.utc).isoformat(),
                topic,
                field,
                target_length,
                outline.get("title", ""),
                json.dumps(outline, ensure_ascii=False),
                int(is_private),
            ),
        )
        return cursor.lastrowid


def list_generations(
    user_id: str, limit: int = 50, q: str | None = None, only_private: bool = False
) -> list[dict]:
    privacy_filter = 1 if only_private else 0
    with _connect() as conn:
        if q and q.strip():
            like = f"%{q.strip()}%"
            rows = conn.execute(
                """
                SELECT id, created_at, topic, field, target_length, title, is_private
                FROM generations
                WHERE user_id = ? AND is_private = ? AND (title LIKE ? OR topic LIKE ?)
                ORDER BY id DESC
                LIMIT ?
                """,
                (user_id, privacy_filter, like, like, limit),
            ).fetchall()
        else:
            rows = conn.execute(
                """
                SELECT id, created_at, topic, field, target_length, title, is_private
                FROM generations
                WHERE user_id = ? AND is_private = ?
                ORDER BY id DESC
                LIMIT ?
                """,
                (user_id, privacy_filter, limit),
            ).fetchall()

    results = [dict(row) for row in rows]
    for item in results:
        item["is_private"] = bool(item["is_private"])
    return results


def get_generation(user_id: str, generation_id: int) -> dict | None:
    with _connect() as conn:
        row = conn.execute(
            """
            SELECT id, created_at, topic, field, target_length, title, outline_json, is_private
            FROM generations
            WHERE id = ? AND user_id = ?
            """,
            (generation_id, user_id),
        ).fetchone()

    if row is None:
        return None

    result = dict(row)
    result["outline"] = json.loads(result.pop("outline_json"))
    result["is_private"] = bool(result["is_private"])
    return result


def delete_generation(user_id: str, generation_id: int) -> bool:
    with _connect() as conn:
        cursor = conn.execute(
            "DELETE FROM generations WHERE id = ? AND user_id = ?", (generation_id, user_id)
        )
        return cursor.rowcount > 0


def set_generation_privacy(user_id: str, generation_id: int, is_private: bool) -> bool:
    with _connect() as conn:
        cursor = conn.execute(
            "UPDATE generations SET is_private = ? WHERE id = ? AND user_id = ?",
            (int(is_private), generation_id, user_id),
        )
        return cursor.rowcount > 0


def create_session(user_id: str, title: str) -> dict:
    now = datetime.now(timezone.utc).isoformat()
    with _connect() as conn:
        cursor = conn.execute(
            "INSERT INTO sessions (user_id, title, messages_json, updated_at) VALUES (?, ?, ?, ?)",
            (user_id, title, "[]", now),
        )
        return {"id": cursor.lastrowid, "title": title, "messages": [], "updated_at": now}


def list_sessions(user_id: str) -> list[dict]:
    with _connect() as conn:
        rows = conn.execute(
            "SELECT id, title, messages_json, updated_at FROM sessions WHERE user_id = ? ORDER BY id ASC",
            (user_id,),
        ).fetchall()

    result = []
    for row in rows:
        item = dict(row)
        item["messages"] = json.loads(item.pop("messages_json"))
        result.append(item)
    return result


def update_session(user_id: str, session_id: int, title: str, messages: list) -> bool:
    with _connect() as conn:
        cursor = conn.execute(
            "UPDATE sessions SET title = ?, messages_json = ?, updated_at = ? WHERE id = ? AND user_id = ?",
            (
                title,
                json.dumps(messages, ensure_ascii=False),
                datetime.now(timezone.utc).isoformat(),
                session_id,
                user_id,
            ),
        )
        return cursor.rowcount > 0


def delete_session(user_id: str, session_id: int) -> bool:
    with _connect() as conn:
        cursor = conn.execute(
            "DELETE FROM sessions WHERE id = ? AND user_id = ?", (session_id, user_id)
        )
        return cursor.rowcount > 0


def _period_key(moment: datetime) -> str:
    return moment.strftime("%Y-%m")


def get_or_create_entitlement(user_id: str) -> dict:
    """user_idの利用量エンタイトルメントを返す。

    行が無ければ free プランで新規作成する。既存行の period_start が
    今の(UTCの)年月と異なる場合は、月次ロールオーバーとして tokens_used を
    0にリセットしてperiod_startを更新する。
    """
    now = datetime.now(timezone.utc)
    with _connect() as conn:
        row = conn.execute(
            "SELECT user_id, plan, tokens_used, period_start, stripe_customer_id FROM entitlements WHERE user_id = ?",
            (user_id,),
        ).fetchone()

        if row is None:
            now_iso = now.isoformat()
            conn.execute(
                "INSERT INTO entitlements (user_id, plan, tokens_used, period_start) VALUES (?, ?, 0, ?)",
                (user_id, DEFAULT_PLAN, now_iso),
            )
            return {
                "user_id": user_id,
                "plan": DEFAULT_PLAN,
                "tokens_used": 0,
                "period_start": now_iso,
                "stripe_customer_id": None,
            }

        entitlement = dict(row)
        period_start = datetime.fromisoformat(entitlement["period_start"])
        if _period_key(period_start) != _period_key(now):
            now_iso = now.isoformat()
            conn.execute(
                "UPDATE entitlements SET tokens_used = 0, period_start = ? WHERE user_id = ?",
                (now_iso, user_id),
            )
            entitlement["tokens_used"] = 0
            entitlement["period_start"] = now_iso
        return entitlement


def add_token_usage(user_id: str, tokens: int) -> dict:
    """ロールオーバーを済ませたうえでtokens_usedに加算し、最新のentitlementを返す。"""
    entitlement = get_or_create_entitlement(user_id)
    new_total = entitlement["tokens_used"] + max(tokens, 0)
    with _connect() as conn:
        conn.execute("UPDATE entitlements SET tokens_used = ? WHERE user_id = ?", (new_total, user_id))
    entitlement["tokens_used"] = new_total
    return entitlement


def set_plan(user_id: str, plan: str) -> None:
    """プランを変更する。Stripe Webhookや手動操作から呼ばれる。"""
    get_or_create_entitlement(user_id)
    with _connect() as conn:
        conn.execute("UPDATE entitlements SET plan = ? WHERE user_id = ?", (plan, user_id))


def set_stripe_customer(user_id: str, stripe_customer_id: str) -> None:
    """StripeのCustomer IDをuser_idに紐付ける(Checkout完了時に一度だけ記録する)。"""
    get_or_create_entitlement(user_id)
    with _connect() as conn:
        conn.execute(
            "UPDATE entitlements SET stripe_customer_id = ? WHERE user_id = ?",
            (stripe_customer_id, user_id),
        )


def get_user_id_by_stripe_customer(stripe_customer_id: str) -> str | None:
    """StripeのCustomer IDから、それに紐付くuser_idを逆引きする(Webhook処理で使う)。"""
    with _connect() as conn:
        row = conn.execute(
            "SELECT user_id FROM entitlements WHERE stripe_customer_id = ?",
            (stripe_customer_id,),
        ).fetchone()
    return row["user_id"] if row else None


def create_code_login(user_id: str, email: str, code_hash: str) -> None:
    """メール+ログインコード方式の新規アカウントを作成する。emailは一意である必要がある。"""
    with _connect() as conn:
        conn.execute(
            "INSERT INTO code_logins (user_id, email, code_hash, created_at) VALUES (?, ?, ?, ?)",
            (user_id, email, code_hash, datetime.now(timezone.utc).isoformat()),
        )


def get_code_login_by_email(email: str) -> dict | None:
    with _connect() as conn:
        row = conn.execute(
            "SELECT user_id, email, code_hash FROM code_logins WHERE email = ?", (email,)
        ).fetchone()
    return dict(row) if row else None


def update_code_login_hash(user_id: str, new_code_hash: str) -> bool:
    """コード再発行時に、ハッシュを新しい値に置き換える(古いコードは無効になる)。"""
    with _connect() as conn:
        cursor = conn.execute(
            "UPDATE code_logins SET code_hash = ? WHERE user_id = ?", (new_code_hash, user_id)
        )
        return cursor.rowcount > 0
