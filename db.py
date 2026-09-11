"""
db.py
-----
生成したアウトラインの履歴をSQLiteに保存・参照するモジュール。

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


def _connect() -> sqlite3.Connection:
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def _ensure_user_id_column(conn: sqlite3.Connection, table: str) -> None:
    """user_id列導入前に作られたDBファイル向けの簡易マイグレーション。

    既存行はLEGACY_USER_IDの所有として引き継ぐ(データを消さずに済ませる)。
    """
    columns = {row["name"] for row in conn.execute(f"PRAGMA table_info({table})").fetchall()}
    if "user_id" in columns:
        return
    conn.execute(f"ALTER TABLE {table} ADD COLUMN user_id TEXT")
    conn.execute(f"UPDATE {table} SET user_id = ? WHERE user_id IS NULL", (LEGACY_USER_ID,))


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
                outline_json TEXT NOT NULL
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

        # user_id列導入前のDBファイルを引き続き使えるようにする簡易マイグレーション。
        _ensure_user_id_column(conn, "generations")
        _ensure_user_id_column(conn, "sessions")
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
            # Appleがメールアドレスを返すのは初回サインイン時のみのことが多いので、
            # 渡ってきた場合だけ上書きする(以降のサインインでNoneに戻さないため)。
            conn.execute("UPDATE users SET email = ? WHERE id = ?", (email, user_id))


def save_generation(user_id: str, topic: str, field: str, target_length: str, outline: dict) -> int:
    with _connect() as conn:
        cursor = conn.execute(
            """
            INSERT INTO generations (user_id, created_at, topic, field, target_length, title, outline_json)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                user_id,
                datetime.now(timezone.utc).isoformat(),
                topic,
                field,
                target_length,
                outline.get("title", ""),
                json.dumps(outline, ensure_ascii=False),
            ),
        )
        return cursor.lastrowid


def list_generations(user_id: str, limit: int = 50, q: str | None = None) -> list[dict]:
    with _connect() as conn:
        if q and q.strip():
            like = f"%{q.strip()}%"
            rows = conn.execute(
                """
                SELECT id, created_at, topic, field, target_length, title
                FROM generations
                WHERE user_id = ? AND (title LIKE ? OR topic LIKE ?)
                ORDER BY id DESC
                LIMIT ?
                """,
                (user_id, like, like, limit),
            ).fetchall()
        else:
            rows = conn.execute(
                """
                SELECT id, created_at, topic, field, target_length, title
                FROM generations
                WHERE user_id = ?
                ORDER BY id DESC
                LIMIT ?
                """,
                (user_id, limit),
            ).fetchall()
        return [dict(row) for row in rows]


def get_generation(user_id: str, generation_id: int) -> dict | None:
    with _connect() as conn:
        row = conn.execute(
            """
            SELECT id, created_at, topic, field, target_length, title, outline_json
            FROM generations
            WHERE id = ? AND user_id = ?
            """,
            (generation_id, user_id),
        ).fetchone()

    if row is None:
        return None

    result = dict(row)
    result["outline"] = json.loads(result.pop("outline_json"))
    return result


def delete_generation(user_id: str, generation_id: int) -> bool:
    with _connect() as conn:
        cursor = conn.execute(
            "DELETE FROM generations WHERE id = ? AND user_id = ?", (generation_id, user_id)
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
