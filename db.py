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
from datetime import date, datetime, timedelta, timezone

from crypto_utils import decrypt_text, encrypt_text

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
            CREATE TABLE IF NOT EXISTS history_entries (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL,
                mode TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                title TEXT NOT NULL,
                payload_json TEXT NOT NULL,
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
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS mfa_enrollments (
                user_id TEXT PRIMARY KEY,
                secret TEXT NOT NULL,
                enabled INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                enabled_at TEXT
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS security_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                created_at TEXT NOT NULL,
                event_type TEXT NOT NULL,
                subject TEXT NOT NULL,
                detail TEXT NOT NULL DEFAULT ''
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS activity_pings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_activity_pings_user_created ON activity_pings(user_id, created_at)"
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS tasks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL,
                description TEXT NOT NULL,
                deadline TEXT,
                estimated_minutes INTEGER NOT NULL,
                remind_at TEXT NOT NULL,
                reasoning TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'pending',
                reminded_at TEXT,
                created_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS ai_agents_subscriptions (
                user_id TEXT PRIMARY KEY,
                enabled INTEGER NOT NULL DEFAULT 0,
                profile_json TEXT NOT NULL,
                last_sent_date TEXT,
                updated_at TEXT NOT NULL
            )
            """
        )

        # 列追加前のDBファイルを引き続き使えるようにする簡易マイグレーション。
        _ensure_column(conn, "generations", "user_id", "TEXT", backfill=LEGACY_USER_ID)
        _ensure_column(conn, "sessions", "user_id", "TEXT", backfill=LEGACY_USER_ID)
        _ensure_column(conn, "generations", "is_private", "INTEGER", backfill=0)
        _ensure_column(conn, "entitlements", "stripe_customer_id", "TEXT")
        _ensure_column(conn, "security_events", "ip_address", "TEXT")
        _ensure_column(conn, "security_events", "user_agent", "TEXT")
        # セッションJWTの一括失効(ログアウト、MFA有効化/無効化)用のバージョン番号。
        # JWTのver claimとこの値が一致しない場合、decode成功後でも無効なトークンとして扱う。
        # "NOT NULL DEFAULT 0"をDDLに含めることで、既存行だけでなく今後INSERTで
        # 明示的に指定しなかった新規行にも自動的に0が入る(NULLのままにならない)。
        _ensure_column(conn, "users", "token_version", "INTEGER NOT NULL DEFAULT 0")
        # ログインコードの有効期限判定用。作成時のcreated_atとは別に持ち、再発行のたびに
        # 更新する(古いDBファイルではcreated_atで代用してバックフィルする)。
        _ensure_column(conn, "code_logins", "code_issued_at", "TEXT")
        conn.execute(
            "UPDATE code_logins SET code_issued_at = created_at WHERE code_issued_at IS NULL"
        )
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


def get_user_email(user_id: str) -> str | None:
    with _connect() as conn:
        row = conn.execute("SELECT email FROM users WHERE id = ?", (user_id,)).fetchone()
    return row["email"] if row and row["email"] else None


def get_token_version(user_id: str) -> int:
    """セッションJWTの検証に使う、このユーザーの現在の有効バージョン。

    ユーザー行がまだ存在しない(初回サインイン前)場合は0(初期値)を返す。
    """
    with _connect() as conn:
        row = conn.execute("SELECT token_version FROM users WHERE id = ?", (user_id,)).fetchone()
    return row["token_version"] if row and row["token_version"] is not None else 0


def bump_token_version(user_id: str) -> int:
    """このユーザーの発行済みセッションJWTを全て無効化し、新しいバージョン番号を返す。

    ログアウト(全端末)、MFA有効化・無効化(盗まれたセッションが残っていても
    無効にするため)で使う。呼び出し元は、必要なら新しいバージョンで
    そのリクエストの発行元セッションだけ新しいトークンを発行し直す。
    """
    with _connect() as conn:
        conn.execute(
            "UPDATE users SET token_version = token_version + 1 WHERE id = ?", (user_id,)
        )
        row = conn.execute("SELECT token_version FROM users WHERE id = ?", (user_id,)).fetchone()
    return row["token_version"] if row else 0


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
                encrypt_text(json.dumps(outline, ensure_ascii=False)),
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
    result["outline"] = json.loads(decrypt_text(result.pop("outline_json")))
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


def save_history_entry(user_id: str, mode: str, title: str, payload: dict, is_private: bool = False) -> dict:
    """logic-guide/task-generator/study-notes/tasksの各モードで共通に使う、汎用の履歴保存。

    outline(論文アウトライン)だけは専用のgenerationsテーブルを使い続けるので対象外。
    """
    now = datetime.now(timezone.utc).isoformat()
    with _connect() as conn:
        cursor = conn.execute(
            """
            INSERT INTO history_entries
                (user_id, mode, created_at, updated_at, title, payload_json, is_private)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (user_id, mode, now, now, title, encrypt_text(json.dumps(payload, ensure_ascii=False)), int(is_private)),
        )
        return {"id": cursor.lastrowid, "mode": mode, "created_at": now, "updated_at": now, "title": title}


def update_history_entry(user_id: str, entry_id: int, mode: str, title: str, payload: dict) -> bool:
    """継続する会話(logic-guideなど)で、同じ履歴を新規行を増やさずに上書き更新する。"""
    now = datetime.now(timezone.utc).isoformat()
    with _connect() as conn:
        cursor = conn.execute(
            """
            UPDATE history_entries SET title = ?, payload_json = ?, updated_at = ?
            WHERE id = ? AND user_id = ? AND mode = ?
            """,
            (title, encrypt_text(json.dumps(payload, ensure_ascii=False)), now, entry_id, user_id, mode),
        )
        return cursor.rowcount > 0


def list_history_entries(
    user_id: str, mode: str, limit: int = 50, q: str | None = None, only_private: bool = False
) -> list[dict]:
    privacy_filter = 1 if only_private else 0
    with _connect() as conn:
        if q and q.strip():
            like = f"%{q.strip()}%"
            rows = conn.execute(
                """
                SELECT id, created_at, updated_at, title, is_private
                FROM history_entries
                WHERE user_id = ? AND mode = ? AND is_private = ? AND title LIKE ?
                ORDER BY id DESC
                LIMIT ?
                """,
                (user_id, mode, privacy_filter, like, limit),
            ).fetchall()
        else:
            rows = conn.execute(
                """
                SELECT id, created_at, updated_at, title, is_private
                FROM history_entries
                WHERE user_id = ? AND mode = ? AND is_private = ?
                ORDER BY id DESC
                LIMIT ?
                """,
                (user_id, mode, privacy_filter, limit),
            ).fetchall()

    results = [dict(row) for row in rows]
    for item in results:
        item["is_private"] = bool(item["is_private"])
    return results


def get_history_entry(user_id: str, entry_id: int) -> dict | None:
    with _connect() as conn:
        row = conn.execute(
            """
            SELECT id, mode, created_at, updated_at, title, payload_json, is_private
            FROM history_entries
            WHERE id = ? AND user_id = ?
            """,
            (entry_id, user_id),
        ).fetchone()

    if row is None:
        return None

    result = dict(row)
    result["payload"] = json.loads(decrypt_text(result.pop("payload_json")))
    result["is_private"] = bool(result["is_private"])
    return result


def delete_history_entry(user_id: str, entry_id: int) -> bool:
    with _connect() as conn:
        cursor = conn.execute(
            "DELETE FROM history_entries WHERE id = ? AND user_id = ?", (entry_id, user_id)
        )
        return cursor.rowcount > 0


def set_history_entry_privacy(user_id: str, entry_id: int, is_private: bool) -> bool:
    with _connect() as conn:
        cursor = conn.execute(
            "UPDATE history_entries SET is_private = ? WHERE id = ? AND user_id = ?",
            (int(is_private), entry_id, user_id),
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
    now_iso = datetime.now(timezone.utc).isoformat()
    with _connect() as conn:
        conn.execute(
            "INSERT INTO code_logins (user_id, email, code_hash, created_at, code_issued_at) "
            "VALUES (?, ?, ?, ?, ?)",
            (user_id, email, code_hash, now_iso, now_iso),
        )


def get_code_login_by_email(email: str) -> dict | None:
    with _connect() as conn:
        row = conn.execute(
            "SELECT user_id, email, code_hash, code_issued_at FROM code_logins WHERE email = ?", (email,)
        ).fetchone()
    return dict(row) if row else None


def update_code_login_hash(user_id: str, new_code_hash: str) -> bool:
    """コード再発行時に、ハッシュを新しい値に置き換える(古いコードは無効になり、
    有効期限もこの時点からリセットされる)。
    """
    with _connect() as conn:
        cursor = conn.execute(
            "UPDATE code_logins SET code_hash = ?, code_issued_at = ? WHERE user_id = ?",
            (new_code_hash, datetime.now(timezone.utc).isoformat(), user_id),
        )
        return cursor.rowcount > 0


def create_task(
    user_id: str,
    description: str,
    deadline: str | None,
    estimated_minutes: int,
    remind_at: str,
    reasoning: str = "",
) -> dict:
    now = datetime.now(timezone.utc).isoformat()
    with _connect() as conn:
        cursor = conn.execute(
            """
            INSERT INTO tasks
                (user_id, description, deadline, estimated_minutes, remind_at, reasoning, status, created_at)
            VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
            """,
            (user_id, description, deadline, estimated_minutes, remind_at, reasoning, now),
        )
        return {
            "id": cursor.lastrowid,
            "description": description,
            "deadline": deadline,
            "estimated_minutes": estimated_minutes,
            "remind_at": remind_at,
            "reasoning": reasoning,
            "status": "pending",
            "reminded_at": None,
            "created_at": now,
        }


def list_tasks(user_id: str) -> list[dict]:
    with _connect() as conn:
        rows = conn.execute(
            """
            SELECT id, description, deadline, estimated_minutes, remind_at, reasoning,
                   status, reminded_at, created_at
            FROM tasks
            WHERE user_id = ?
            ORDER BY remind_at ASC
            """,
            (user_id,),
        ).fetchall()
    return [dict(row) for row in rows]


def set_task_status(user_id: str, task_id: int, status: str) -> bool:
    with _connect() as conn:
        cursor = conn.execute(
            "UPDATE tasks SET status = ? WHERE id = ? AND user_id = ?",
            (status, task_id, user_id),
        )
        return cursor.rowcount > 0


def delete_task(user_id: str, task_id: int) -> bool:
    with _connect() as conn:
        cursor = conn.execute("DELETE FROM tasks WHERE id = ? AND user_id = ?", (task_id, user_id))
        return cursor.rowcount > 0


def list_due_reminders(now_iso: str) -> list[dict]:
    """リマインド時刻を過ぎた未完了・未通知のタスクを、送信先メールアドレス付きで返す。"""
    with _connect() as conn:
        rows = conn.execute(
            """
            SELECT tasks.id, tasks.description, tasks.deadline, tasks.estimated_minutes, users.email
            FROM tasks
            JOIN users ON users.id = tasks.user_id
            WHERE tasks.status = 'pending' AND tasks.reminded_at IS NULL AND tasks.remind_at <= ?
            """,
            (now_iso,),
        ).fetchall()
    return [dict(row) for row in rows]


def mark_task_reminded(task_id: int) -> None:
    with _connect() as conn:
        conn.execute(
            "UPDATE tasks SET reminded_at = ? WHERE id = ?",
            (datetime.now(timezone.utc).isoformat(), task_id),
        )


def upsert_ai_agents_subscription(user_id: str, enabled: bool, profile: dict) -> None:
    """ai-agentsの「毎朝9時にリマインド」設定を保存する(プロフィールはJSONにまとめて暗号化)。"""
    now = datetime.now(timezone.utc).isoformat()
    with _connect() as conn:
        conn.execute(
            """
            INSERT INTO ai_agents_subscriptions (user_id, enabled, profile_json, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET
                enabled = excluded.enabled,
                profile_json = excluded.profile_json,
                updated_at = excluded.updated_at
            """,
            (user_id, int(enabled), encrypt_text(json.dumps(profile, ensure_ascii=False)), now),
        )


def get_ai_agents_subscription(user_id: str) -> dict | None:
    with _connect() as conn:
        row = conn.execute(
            "SELECT user_id, enabled, profile_json, last_sent_date FROM ai_agents_subscriptions WHERE user_id = ?",
            (user_id,),
        ).fetchone()
    if row is None:
        return None
    result = dict(row)
    result["enabled"] = bool(result["enabled"])
    result["profile"] = json.loads(decrypt_text(result.pop("profile_json")))
    return result


def list_due_ai_agents_subscriptions(today: str) -> list[dict]:
    """有効化済みで、今日まだ送信していないユーザーを、送信先メールアドレス付きで返す。"""
    with _connect() as conn:
        rows = conn.execute(
            """
            SELECT ai_agents_subscriptions.user_id, ai_agents_subscriptions.profile_json, users.email
            FROM ai_agents_subscriptions
            JOIN users ON users.id = ai_agents_subscriptions.user_id
            WHERE ai_agents_subscriptions.enabled = 1
              AND (ai_agents_subscriptions.last_sent_date IS NULL OR ai_agents_subscriptions.last_sent_date != ?)
            """,
            (today,),
        ).fetchall()
    results = []
    for row in rows:
        item = dict(row)
        item["profile"] = json.loads(decrypt_text(item.pop("profile_json")))
        results.append(item)
    return results


def mark_ai_agents_subscription_sent(user_id: str, today: str) -> None:
    with _connect() as conn:
        conn.execute(
            "UPDATE ai_agents_subscriptions SET last_sent_date = ? WHERE user_id = ?",
            (today, user_id),
        )


def get_mfa_enrollment(user_id: str) -> dict | None:
    """MFA登録行を返す(secretは復号済み)。未登録ならNone。"""
    with _connect() as conn:
        row = conn.execute(
            "SELECT user_id, secret, enabled, created_at, enabled_at FROM mfa_enrollments WHERE user_id = ?",
            (user_id,),
        ).fetchone()
    if row is None:
        return None
    result = dict(row)
    result["secret"] = decrypt_text(result["secret"])
    result["enabled"] = bool(result["enabled"])
    return result


def is_mfa_enabled(user_id: str) -> bool:
    with _connect() as conn:
        row = conn.execute(
            "SELECT enabled FROM mfa_enrollments WHERE user_id = ?", (user_id,)
        ).fetchone()
    return bool(row and row["enabled"])


def set_mfa_secret(user_id: str, secret: str) -> None:
    """未確認状態(enabled=0)でシークレットを登録/置き換える。有効化済みの行は上書きしない想定で呼ぶ。"""
    with _connect() as conn:
        conn.execute(
            """
            INSERT INTO mfa_enrollments (user_id, secret, enabled, created_at, enabled_at)
            VALUES (?, ?, 0, ?, NULL)
            ON CONFLICT(user_id) DO UPDATE SET secret = excluded.secret, enabled = 0, enabled_at = NULL
            """,
            (user_id, encrypt_text(secret), datetime.now(timezone.utc).isoformat()),
        )


def enable_mfa(user_id: str) -> bool:
    with _connect() as conn:
        cursor = conn.execute(
            "UPDATE mfa_enrollments SET enabled = 1, enabled_at = ? WHERE user_id = ?",
            (datetime.now(timezone.utc).isoformat(), user_id),
        )
        return cursor.rowcount > 0


def delete_mfa(user_id: str) -> bool:
    with _connect() as conn:
        cursor = conn.execute("DELETE FROM mfa_enrollments WHERE user_id = ?", (user_id,))
        return cursor.rowcount > 0


def record_security_event(
    event_type: str,
    subject: str,
    detail: str = "",
    ip_address: str | None = None,
    user_agent: str | None = None,
) -> None:
    """ログイン失敗・ロック・MFA変更など、インシデント調査に必要な事象を記録する。

    公開後はApple/Google/GitHub/メールコードの全ログイン方式で発生しうるため、
    ip_address/user_agentも残し、後から「誰が・どこから・どの方式で」ログインしたか
    追跡できるようにする。
    """
    with _connect() as conn:
        conn.execute(
            """
            INSERT INTO security_events (created_at, event_type, subject, detail, ip_address, user_agent)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (datetime.now(timezone.utc).isoformat(), event_type, subject, detail, ip_address, user_agent),
        )


def list_security_events(subject: str, limit: int = 20) -> list[dict]:
    with _connect() as conn:
        rows = conn.execute(
            """
            SELECT id, created_at, event_type, detail
            FROM security_events
            WHERE subject = ?
            ORDER BY id DESC
            LIMIT ?
            """,
            (subject, limit),
        ).fetchall()
    return [dict(row) for row in rows]


_LOGIN_EVENT_TYPES = (
    "login_success",
    "login_failed",
    "login_locked",
    "mfa_failed",
    "mfa_confirm_failed",
    "mfa_disable_failed",
    "mfa_enabled",
    "mfa_disabled",
    "logout_all",
)


def list_login_events(
    limit: int = 50,
    offset: int = 0,
    event_type: str | None = None,
    q: str | None = None,
) -> tuple[list[dict], int]:
    """運営者向け管理ダッシュボードの「ログイン履歴」向けに、全ユーザー分の
    ログイン関連イベントをページング・絞り込みして返す。(items, total件数)のタプル。
    """
    where = ["event_type IN ({})".format(",".join("?" for _ in _LOGIN_EVENT_TYPES))]
    params: list = list(_LOGIN_EVENT_TYPES)

    if event_type:
        where.append("event_type = ?")
        params.append(event_type)
    if q:
        where.append("(subject LIKE ? OR detail LIKE ?)")
        like = f"%{q}%"
        params.extend([like, like])

    where_sql = " AND ".join(where)

    with _connect() as conn:
        total = conn.execute(
            f"SELECT COUNT(*) AS n FROM security_events WHERE {where_sql}", params
        ).fetchone()["n"]
        rows = conn.execute(
            f"""
            SELECT se.id, se.created_at, se.event_type, se.subject, se.detail,
                   se.ip_address, se.user_agent, u.email AS subject_email
            FROM security_events se
            LEFT JOIN users u ON u.id = se.subject OR u.email = se.subject
            WHERE {where_sql}
            ORDER BY se.id DESC
            LIMIT ? OFFSET ?
            """,
            params + [limit, offset],
        ).fetchall()

    return [dict(row) for row in rows], total


# フロントは画面を開いている間、60秒おきに/activity/pingを叩く。この間隔より少し
# 広めに閾値を取り、連続するpingの間隔がこれ以内ならその間ずっと滞在していたとみなして
# 滞在時間に加算する(離席・タブを閉じた後の間隔は加算しない)。
_ACTIVITY_HEARTBEAT_INTERVAL_SECONDS = 60
_ACTIVITY_MAX_GAP_SECONDS = _ACTIVITY_HEARTBEAT_INTERVAL_SECONDS * 1.5


def record_activity_ping(user_id: str) -> None:
    """ホーム画面の利用時間集計向けに、アクティブなタブからの生存確認を1件記録する。"""
    with _connect() as conn:
        conn.execute(
            "INSERT INTO activity_pings (user_id, created_at) VALUES (?, ?)",
            (user_id, datetime.now(timezone.utc).isoformat()),
        )


def _shift_months(d: date, delta_months: int) -> date:
    month_index = d.month - 1 + delta_months
    year = d.year + month_index // 12
    month = month_index % 12 + 1
    return d.replace(year=year, month=month, day=1)


def _active_seconds_by_day(user_id: str, since: datetime) -> dict[str, float]:
    with _connect() as conn:
        rows = conn.execute(
            "SELECT created_at FROM activity_pings WHERE user_id = ? AND created_at >= ? ORDER BY created_at",
            (user_id, since.isoformat()),
        ).fetchall()

    seconds_by_day: dict[str, float] = {}
    prev: datetime | None = None
    for row in rows:
        ts = datetime.fromisoformat(row["created_at"])
        if prev is not None:
            gap = (ts - prev).total_seconds()
            if 0 < gap <= _ACTIVITY_MAX_GAP_SECONDS:
                day_key = prev.date().isoformat()
                seconds_by_day[day_key] = seconds_by_day.get(day_key, 0.0) + gap
        prev = ts
    return seconds_by_day


def get_activity_summary(user_id: str, granularity: str) -> list[dict]:
    """ホーム画面の利用時間グラフ向けに、日別('day')直近14日・週別('week')直近12週・
    月別('year')直近12か月のバケットで、アクティブだった時間(分)を集計して返す。
    """
    now = datetime.now(timezone.utc)
    if granularity == "week":
        since = now - timedelta(weeks=12)
    elif granularity == "year":
        since = now - timedelta(days=366)
    else:
        since = now - timedelta(days=14)

    seconds_by_day = _active_seconds_by_day(user_id, since)

    order: list[str] = []
    buckets: dict[str, float] = {}
    if granularity == "week":
        for offset in range(11, -1, -1):
            week_start = (now - timedelta(weeks=offset)).date()
            week_start -= timedelta(days=week_start.weekday())
            key = week_start.isoformat()
            if key not in buckets:
                buckets[key] = 0.0
                order.append(key)
    elif granularity == "year":
        for offset in range(11, -1, -1):
            key = _shift_months(now.date(), -offset).strftime("%Y-%m")
            if key not in buckets:
                buckets[key] = 0.0
                order.append(key)
    else:
        for offset in range(13, -1, -1):
            key = (now - timedelta(days=offset)).date().isoformat()
            buckets[key] = 0.0
            order.append(key)

    for day_str, seconds in seconds_by_day.items():
        day = date.fromisoformat(day_str)
        if granularity == "week":
            key = (day - timedelta(days=day.weekday())).isoformat()
        elif granularity == "year":
            key = day.strftime("%Y-%m")
        else:
            key = day.isoformat()
        if key in buckets:
            buckets[key] += seconds

    return [{"bucket": key, "minutes": round(buckets[key] / 60, 1)} for key in order]


def get_admin_overview() -> dict:
    """運営者向け管理ダッシュボードの集計値をまとめて返す。

    いずれも既存テーブル(users/entitlements/generations/activity_pings/security_events)を
    読むだけで、書き込みは行わない。
    """
    now = datetime.now(timezone.utc)
    since_24h = (now - timedelta(hours=24)).isoformat()
    since_7d = (now - timedelta(days=7)).isoformat()
    since_30d = (now - timedelta(days=30)).isoformat()

    with _connect() as conn:
        total_users = conn.execute("SELECT COUNT(*) AS n FROM users").fetchone()["n"]
        new_users_7d = conn.execute(
            "SELECT COUNT(*) AS n FROM users WHERE created_at >= ?", (since_7d,)
        ).fetchone()["n"]
        new_users_30d = conn.execute(
            "SELECT COUNT(*) AS n FROM users WHERE created_at >= ?", (since_30d,)
        ).fetchone()["n"]

        plan_rows = conn.execute(
            "SELECT plan, COUNT(*) AS n FROM entitlements GROUP BY plan"
        ).fetchall()
        plan_counts = {row["plan"]: row["n"] for row in plan_rows}

        tokens_used_this_period = conn.execute(
            "SELECT COALESCE(SUM(tokens_used), 0) AS n FROM entitlements"
        ).fetchone()["n"]

        paying_users = conn.execute(
            "SELECT COUNT(*) AS n FROM entitlements WHERE stripe_customer_id IS NOT NULL"
        ).fetchone()["n"]

        total_generations = conn.execute("SELECT COUNT(*) AS n FROM generations").fetchone()["n"]
        generations_7d = conn.execute(
            "SELECT COUNT(*) AS n FROM generations WHERE created_at >= ?", (since_7d,)
        ).fetchone()["n"]
        generations_30d = conn.execute(
            "SELECT COUNT(*) AS n FROM generations WHERE created_at >= ?", (since_30d,)
        ).fetchone()["n"]

        active_users_24h = conn.execute(
            "SELECT COUNT(DISTINCT user_id) AS n FROM activity_pings WHERE created_at >= ?",
            (since_24h,),
        ).fetchone()["n"]
        active_users_7d = conn.execute(
            "SELECT COUNT(DISTINCT user_id) AS n FROM activity_pings WHERE created_at >= ?",
            (since_7d,),
        ).fetchone()["n"]

        recent_security_events = [
            dict(row)
            for row in conn.execute(
                """
                SELECT se.created_at, se.event_type, se.subject, se.detail, u.email AS subject_email
                FROM security_events se
                LEFT JOIN users u ON u.id = se.subject OR u.email = se.subject
                ORDER BY se.id DESC
                LIMIT 10
                """
            ).fetchall()
        ]

    return {
        "generated_at": now.isoformat(),
        "users": {
            "total": total_users,
            "new_7d": new_users_7d,
            "new_30d": new_users_30d,
            "active_24h": active_users_24h,
            "active_7d": active_users_7d,
        },
        "plans": {
            "free": plan_counts.get("free", 0),
            "pro": plan_counts.get("pro", 0),
            "max": plan_counts.get("max", 0),
            "paying": paying_users,
        },
        "usage": {
            "tokens_used_this_period": tokens_used_this_period,
        },
        "generations": {
            "total": total_generations,
            "last_7d": generations_7d,
            "last_30d": generations_30d,
        },
        "recent_security_events": recent_security_events,
    }


# 運営者向け「プロンプト分析」向け。generations(論文アウトライン)は元々topic/fieldが
# 平文列なので復号不要。history_entriesは各モードの入力プロンプトの短い要約が平文の
# titleに入っている(logic-guide/ai-agentsは大学・分野等のラベル、tasks/task-generator/
# study-notesは実際の依頼文の先頭60文字)ため、一覧はこのtitleだけで復号せずに済ませ、
# 会話全文などの詳細を見たい場合だけ get_prompt_entry_detail() で都度復号する。
_PROMPT_HISTORY_MODES = ("logic-guide", "ai-agents", "task-generator", "study-notes", "tasks")

# キーワード頻度集計用の簡易ストップワード(助詞・汎用語)。形態素解析はせず、
# 英数字の連続 / ひらがな・カタカナ・漢字の連続を単純に1トークンとして扱う荒い方式なので、
# 出現しやすい機能語だけ手動で除外してノイズを減らす。
_KEYWORD_STOPWORDS = {
    "の", "を", "に", "は", "が", "で", "と", "も", "や", "へ", "から", "まで", "より",
    "ため", "こと", "もの", "これ", "それ", "あれ", "この", "その", "あの", "です", "ます",
    "する", "した", "して", "いる", "ある", "ない", "について", "における", "です", "ください",
}


def _tokenize_for_keywords(text: str) -> list[str]:
    import re

    if not text:
        return []
    tokens = re.findall(r"[A-Za-z0-9]+|[぀-ヿ一-鿿]+", text)
    return [t for t in tokens if len(t) >= 2 and t not in _KEYWORD_STOPWORDS]


def get_prompt_analytics() -> dict:
    """運営者向け「プロンプト分析」タブの集計値(機能別件数・よく使われる分野・
    頻出キーワード)。個別ユーザーの会話全文は読まず、平文の要約列だけを見る。
    """
    now = datetime.now(timezone.utc)
    since_7d = (now - timedelta(days=7)).isoformat()
    since_30d = (now - timedelta(days=30)).isoformat()

    with _connect() as conn:
        def _counts(where_extra: str = "", params: tuple = ()) -> dict:
            total = conn.execute(
                f"SELECT COUNT(*) AS n FROM generations WHERE 1=1 {where_extra}", params
            ).fetchone()["n"]
            return total

        mode_counts: dict[str, dict[str, int]] = {}
        mode_counts["outline"] = {
            "total": conn.execute("SELECT COUNT(*) AS n FROM generations").fetchone()["n"],
            "last_7d": conn.execute(
                "SELECT COUNT(*) AS n FROM generations WHERE created_at >= ?", (since_7d,)
            ).fetchone()["n"],
            "last_30d": conn.execute(
                "SELECT COUNT(*) AS n FROM generations WHERE created_at >= ?", (since_30d,)
            ).fetchone()["n"],
        }
        for mode in _PROMPT_HISTORY_MODES:
            mode_counts[mode] = {
                "total": conn.execute(
                    "SELECT COUNT(*) AS n FROM history_entries WHERE mode = ?", (mode,)
                ).fetchone()["n"],
                "last_7d": conn.execute(
                    "SELECT COUNT(*) AS n FROM history_entries WHERE mode = ? AND created_at >= ?",
                    (mode, since_7d),
                ).fetchone()["n"],
                "last_30d": conn.execute(
                    "SELECT COUNT(*) AS n FROM history_entries WHERE mode = ? AND created_at >= ?",
                    (mode, since_30d),
                ).fetchone()["n"],
            }

        top_fields = [
            dict(row)
            for row in conn.execute(
                "SELECT field, COUNT(*) AS n FROM generations GROUP BY field ORDER BY n DESC LIMIT 10"
            ).fetchall()
        ]

        texts = [row["topic"] for row in conn.execute("SELECT topic FROM generations").fetchall()]
        texts += [row["title"] for row in conn.execute("SELECT title FROM history_entries").fetchall()]

    keyword_counter: dict[str, int] = {}
    for text in texts:
        for token in _tokenize_for_keywords(text or ""):
            keyword_counter[token] = keyword_counter.get(token, 0) + 1
    top_keywords = [
        {"keyword": k, "count": c}
        for k, c in sorted(keyword_counter.items(), key=lambda kv: kv[1], reverse=True)[:20]
    ]

    return {
        "generated_at": now.isoformat(),
        "counts_by_mode": mode_counts,
        "top_fields": top_fields,
        "top_keywords": top_keywords,
    }


def list_prompt_entries(
    limit: int = 50,
    offset: int = 0,
    mode: str | None = None,
    q: str | None = None,
) -> tuple[list[dict], int]:
    """運営者向け「プロンプト分析」の個別一覧。会話全文は含めず、平文の要約
    (topic/title)だけをページング・絞り込みして返す(items, total件数)。
    """
    where = []
    params: list = []
    if mode:
        where.append("mode = ?")
        params.append(mode)
    if q:
        where.append("(summary LIKE ? OR user_id LIKE ?)")
        like = f"%{q}%"
        params.extend([like, like])
    where_sql = f"WHERE {' AND '.join(where)}" if where else ""

    union_sql = """
        SELECT id, user_id, created_at, 'outline' AS mode, topic AS summary,
               field AS extra, 'generations' AS source
        FROM generations
        UNION ALL
        SELECT id, user_id, created_at, mode, title AS summary,
               NULL AS extra, 'history_entries' AS source
        FROM history_entries
    """

    with _connect() as conn:
        total = conn.execute(
            f"SELECT COUNT(*) AS n FROM ({union_sql}) {where_sql}", params
        ).fetchone()["n"]
        rows = conn.execute(
            f"""
            SELECT p.id, p.user_id, p.created_at, p.mode, p.summary, p.extra, p.source, u.email AS subject_email
            FROM ({union_sql}) p
            LEFT JOIN users u ON u.id = p.user_id
            {where_sql}
            ORDER BY p.created_at DESC
            LIMIT ? OFFSET ?
            """,
            params + [limit, offset],
        ).fetchall()

    return [dict(row) for row in rows], total


def get_prompt_entry_detail(source: str, entry_id: int) -> dict | None:
    """運営者が個別の記録を選んで初めて復号する詳細ビュー。一覧(list_prompt_entries)
    では会話全文・生成結果を読まずに済ませ、必要な時だけここで復号する。
    """
    with _connect() as conn:
        if source == "generations":
            row = conn.execute(
                """
                SELECT g.id, g.user_id, g.created_at, g.topic, g.field, g.target_length,
                       g.title, g.outline_json, u.email AS subject_email
                FROM generations g
                LEFT JOIN users u ON u.id = g.user_id
                WHERE g.id = ?
                """,
                (entry_id,),
            ).fetchone()
            if row is None:
                return None
            result = dict(row)
            result["outline"] = json.loads(decrypt_text(result.pop("outline_json")))
            return result

        if source == "history_entries":
            row = conn.execute(
                """
                SELECT h.id, h.user_id, h.mode, h.created_at, h.updated_at, h.title,
                       h.payload_json, u.email AS subject_email
                FROM history_entries h
                LEFT JOIN users u ON u.id = h.user_id
                WHERE h.id = ?
                """,
                (entry_id,),
            ).fetchone()
            if row is None:
                return None
            result = dict(row)
            result["payload"] = json.loads(decrypt_text(result.pop("payload_json")))
            return result

    raise ValueError(f"unknown source: {source}")
