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


def _connect() -> sqlite3.Connection:
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    with _connect() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS generations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                created_at TEXT NOT NULL,
                topic TEXT NOT NULL,
                field TEXT NOT NULL,
                target_length TEXT,
                title TEXT NOT NULL,
                outline_json TEXT NOT NULL
            )
            """
        )


def save_generation(topic: str, field: str, target_length: str, outline: dict) -> int:
    with _connect() as conn:
        cursor = conn.execute(
            """
            INSERT INTO generations (created_at, topic, field, target_length, title, outline_json)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                datetime.now(timezone.utc).isoformat(),
                topic,
                field,
                target_length,
                outline.get("title", ""),
                json.dumps(outline, ensure_ascii=False),
            ),
        )
        return cursor.lastrowid


def list_generations(limit: int = 50) -> list[dict]:
    with _connect() as conn:
        rows = conn.execute(
            """
            SELECT id, created_at, topic, field, target_length, title
            FROM generations
            ORDER BY id DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
        return [dict(row) for row in rows]


def get_generation(generation_id: int) -> dict | None:
    with _connect() as conn:
        row = conn.execute(
            """
            SELECT id, created_at, topic, field, target_length, title, outline_json
            FROM generations
            WHERE id = ?
            """,
            (generation_id,),
        ).fetchone()

    if row is None:
        return None

    result = dict(row)
    result["outline"] = json.loads(result.pop("outline_json"))
    return result
