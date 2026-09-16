from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from fastapi.testclient import TestClient

import app as app_module
import db
from app import app

client = TestClient(app)


def _fake_estimate(minutes=45, reasoning="テスト用の固定見積もり"):
    def _inner(description):
        return {
            "estimated_minutes": minutes,
            "reasoning": reasoning,
            "_token_usage": {"input_tokens": 10, "output_tokens": 5},
        }

    return _inner


def test_create_task_without_deadline_reminds_after_estimated_minutes():
    headers = {"X-Dev-User-Id": "task-user-no-deadline"}
    before = datetime.now(timezone.utc)

    with patch("app.estimate_task_duration", side_effect=_fake_estimate(minutes=45)):
        resp = client.post("/tasks", json={"description": "統計学のレポートを書く"}, headers=headers)

    assert resp.status_code == 200
    body = resp.json()
    assert body["estimated_minutes"] == 45
    assert body["status"] == "pending"
    assert body["reasoning"] == "テスト用の固定見積もり"

    remind_at = datetime.fromisoformat(body["remind_at"])
    expected = before + timedelta(minutes=45)
    assert abs((remind_at - expected).total_seconds()) < 30


def test_create_task_with_future_deadline_reminds_before_deadline():
    headers = {"X-Dev-User-Id": "task-user-with-deadline"}
    deadline = (datetime.now(timezone.utc) + timedelta(hours=3)).isoformat()

    with patch("app.estimate_task_duration", side_effect=_fake_estimate(minutes=60)):
        resp = client.post(
            "/tasks", json={"description": "英語のエッセイを書く", "deadline": deadline}, headers=headers
        )

    assert resp.status_code == 200
    body = resp.json()

    remind_at = datetime.fromisoformat(body["remind_at"])
    expected = datetime.fromisoformat(deadline) - timedelta(minutes=60)
    assert abs((remind_at - expected).total_seconds()) < 30


def test_create_task_with_deadline_sooner_than_estimate_reminds_immediately():
    headers = {"X-Dev-User-Id": "task-user-urgent-deadline"}
    near_now = datetime.now(timezone.utc)
    deadline = (near_now + timedelta(minutes=5)).isoformat()

    with patch("app.estimate_task_duration", side_effect=_fake_estimate(minutes=120)):
        resp = client.post(
            "/tasks", json={"description": "締切間近の課題", "deadline": deadline}, headers=headers
        )

    assert resp.status_code == 200
    body = resp.json()
    remind_at = datetime.fromisoformat(body["remind_at"])
    # 「締切 - 見積もり」が過去になるケースなので、今すぐリマインドされる扱いになる
    assert (remind_at - near_now).total_seconds() < 30


def test_create_task_rejects_invalid_deadline_format():
    headers = {"X-Dev-User-Id": "task-user-bad-deadline"}
    resp = client.post(
        "/tasks", json={"description": "何かのタスク", "deadline": "not-a-date"}, headers=headers
    )
    assert resp.status_code == 400


def test_create_task_rejects_empty_description():
    headers = {"X-Dev-User-Id": "task-user-empty"}
    resp = client.post("/tasks", json={"description": "   "}, headers=headers)
    assert resp.status_code == 400


def test_list_tasks_scoped_to_user():
    headers_a = {"X-Dev-User-Id": "task-user-a"}
    headers_b = {"X-Dev-User-Id": "task-user-b"}

    with patch("app.estimate_task_duration", side_effect=_fake_estimate()):
        client.post("/tasks", json={"description": "Aさんのタスク"}, headers=headers_a)

    resp_a = client.get("/tasks", headers=headers_a)
    resp_b = client.get("/tasks", headers=headers_b)
    assert resp_a.status_code == 200 and resp_b.status_code == 200
    assert any(t["description"] == "Aさんのタスク" for t in resp_a.json()["items"])
    assert all(t["description"] != "Aさんのタスク" for t in resp_b.json()["items"])


def test_update_task_status_and_delete():
    headers = {"X-Dev-User-Id": "task-user-lifecycle"}
    with patch("app.estimate_task_duration", side_effect=_fake_estimate()):
        created = client.post("/tasks", json={"description": "完了させるタスク"}, headers=headers).json()

    task_id = created["id"]

    done = client.put(f"/tasks/{task_id}/status", json={"status": "done"}, headers=headers)
    assert done.status_code == 200
    items = client.get("/tasks", headers=headers).json()["items"]
    assert next(t for t in items if t["id"] == task_id)["status"] == "done"

    bad_status = client.put(f"/tasks/{task_id}/status", json={"status": "bogus"}, headers=headers)
    assert bad_status.status_code == 400

    deleted = client.delete(f"/tasks/{task_id}", headers=headers)
    assert deleted.status_code == 200
    items_after = client.get("/tasks", headers=headers).json()["items"]
    assert all(t["id"] != task_id for t in items_after)


def test_update_or_delete_other_users_task_returns_404():
    owner_headers = {"X-Dev-User-Id": "task-owner"}
    intruder_headers = {"X-Dev-User-Id": "task-intruder"}

    with patch("app.estimate_task_duration", side_effect=_fake_estimate()):
        created = client.post("/tasks", json={"description": "他人のタスク"}, headers=owner_headers).json()

    task_id = created["id"]
    assert client.put(
        f"/tasks/{task_id}/status", json={"status": "done"}, headers=intruder_headers
    ).status_code == 404
    assert client.delete(f"/tasks/{task_id}", headers=intruder_headers).status_code == 404


def test_task_creation_blocked_with_402_when_quota_exceeded(monkeypatch):
    monkeypatch.setattr(app_module, "PLAN_TOKEN_QUOTAS", {"free": 10, "pro": 200_000, "max": 1_000_000})
    db.add_token_usage("task-quota-user", 999)

    resp = client.post(
        "/tasks",
        json={"description": "枠を使い切った後のタスク"},
        headers={"X-Dev-User-Id": "task-quota-user"},
    )
    assert resp.status_code == 402


def test_task_endpoints_require_auth_when_dev_bypass_disabled(monkeypatch):
    monkeypatch.setattr(app_module, "DEV_BYPASS_USER_ID", "")
    assert client.get("/tasks", headers={"X-Dev-User-Id": ""}).status_code == 401
    assert client.post(
        "/tasks", json={"description": "x"}, headers={"X-Dev-User-Id": ""}
    ).status_code == 401


def test_task_rate_limit_returns_429_when_exceeded(monkeypatch):
    monkeypatch.setattr(app_module, "TASK_RATE_LIMIT_PER_MINUTE", 1)
    headers = {"X-Dev-User-Id": "task-rate-limit-user"}

    with patch("app.estimate_task_duration", side_effect=_fake_estimate()):
        first = client.post("/tasks", json={"description": "1件目"}, headers=headers)
        assert first.status_code == 200
        second = client.post("/tasks", json={"description": "2件目"}, headers=headers)
        assert second.status_code == 429


def test_due_reminder_sends_email_once_and_skips_users_without_email():
    db.upsert_user("reminder-user-with-email", "reminder-target@example.com")
    past = (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()

    db.create_task("reminder-user-with-email", "メールが届くはずのタスク", None, 30, past)
    db.create_task("reminder-user-without-email", "メールが届かないタスク", None, 30, past)

    with patch("app.send_email") as mock_send_email:
        app_module._send_due_task_reminders()

    mock_send_email.assert_called_once()
    to, subject, body = mock_send_email.call_args.args
    assert to == "reminder-target@example.com"
    assert "メールが届くはずのタスク" in body

    # 既読(reminded_at設定済み)になっているので、再実行しても再送されない
    with patch("app.send_email") as mock_send_email_again:
        app_module._send_due_task_reminders()
    mock_send_email_again.assert_not_called()


def test_reminder_not_sent_before_remind_at_time():
    db.upsert_user("reminder-user-future", "future@example.com")
    future = (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()
    db.create_task("reminder-user-future", "まだリマインドされないタスク", None, 30, future)

    with patch("app.send_email") as mock_send_email:
        app_module._send_due_task_reminders()

    mock_send_email.assert_not_called()
