from unittest.mock import MagicMock, patch

import stripe
from fastapi.testclient import TestClient

import app as app_module
import db
from app import app
from conftest import DEFAULT_TEST_USER_ID

client = TestClient(app)
client.headers["X-Dev-User-Id"] = DEFAULT_TEST_USER_ID


def _configure_stripe(monkeypatch, prices=None):
    monkeypatch.setattr(app_module.stripe, "api_key", "sk_test_fake")
    monkeypatch.setattr(app_module, "STRIPE_WEBHOOK_SECRET", "whsec_fake")
    monkeypatch.setattr(
        app_module,
        "STRIPE_PLAN_PRICE_IDS",
        prices or {"pro": "price_pro_fake", "max": "price_max_fake"},
    )
    monkeypatch.setattr(
        app_module,
        "STRIPE_PRICE_ID_TO_PLAN",
        {v: k for k, v in (prices or {"pro": "price_pro_fake", "max": "price_max_fake"}).items()},
    )


# --- /billing/checkout ---


def test_billing_checkout_requires_auth():
    resp = client.post("/billing/checkout", json={"plan": "pro"}, headers={"X-Dev-User-Id": ""})
    assert resp.status_code == 401


def test_billing_checkout_returns_503_when_stripe_not_configured(monkeypatch):
    monkeypatch.setattr(app_module.stripe, "api_key", "")
    resp = client.post("/billing/checkout", json={"plan": "pro"})
    assert resp.status_code == 503


def test_billing_checkout_returns_400_for_unknown_plan(monkeypatch):
    _configure_stripe(monkeypatch)
    resp = client.post("/billing/checkout", json={"plan": "ultra"})
    assert resp.status_code == 400


def test_billing_checkout_creates_session_and_returns_url(monkeypatch):
    _configure_stripe(monkeypatch)
    fake_session = MagicMock(url="https://checkout.stripe.com/session/xyz")

    with patch("app.stripe.checkout.Session.create", return_value=fake_session) as mock_create:
        resp = client.post("/billing/checkout", json={"plan": "pro"})

    assert resp.status_code == 200
    assert resp.json() == {"checkout_url": "https://checkout.stripe.com/session/xyz"}
    call_kwargs = mock_create.call_args.kwargs
    assert call_kwargs["client_reference_id"] == DEFAULT_TEST_USER_ID
    assert call_kwargs["line_items"] == [{"price": "price_pro_fake", "quantity": 1}]
    assert call_kwargs["mode"] == "subscription"


def test_billing_checkout_reuses_existing_stripe_customer(monkeypatch):
    _configure_stripe(monkeypatch)
    db.set_stripe_customer(DEFAULT_TEST_USER_ID, "cus_existing123")
    fake_session = MagicMock(url="https://checkout.stripe.com/session/xyz")

    with patch("app.stripe.checkout.Session.create", return_value=fake_session) as mock_create:
        resp = client.post("/billing/checkout", json={"plan": "pro"})

    assert resp.status_code == 200
    assert mock_create.call_args.kwargs["customer"] == "cus_existing123"


def test_billing_checkout_returns_502_on_stripe_error(monkeypatch):
    _configure_stripe(monkeypatch)
    with patch(
        "app.stripe.checkout.Session.create",
        side_effect=stripe.error.StripeError("boom"),
    ):
        resp = client.post("/billing/checkout", json={"plan": "pro"})
    assert resp.status_code == 502


# --- /billing/portal ---


def test_billing_portal_requires_stripe_configured(monkeypatch):
    monkeypatch.setattr(app_module.stripe, "api_key", "")
    resp = client.post("/billing/portal")
    assert resp.status_code == 503


def test_billing_portal_requires_existing_customer(monkeypatch):
    _configure_stripe(monkeypatch)
    resp = client.post("/billing/portal", headers={"X-Dev-User-Id": "no-stripe-customer-user"})
    assert resp.status_code == 400


def test_billing_portal_creates_session(monkeypatch):
    _configure_stripe(monkeypatch)
    db.set_stripe_customer(DEFAULT_TEST_USER_ID, "cus_existing123")
    fake_session = MagicMock(url="https://billing.stripe.com/portal/xyz")

    with patch("app.stripe.billing_portal.Session.create", return_value=fake_session) as mock_create:
        resp = client.post("/billing/portal")

    assert resp.status_code == 200
    assert resp.json() == {"portal_url": "https://billing.stripe.com/portal/xyz"}
    assert mock_create.call_args.kwargs["customer"] == "cus_existing123"


# --- /billing/webhook ---


def test_billing_webhook_requires_secret_configured(monkeypatch):
    monkeypatch.setattr(app_module, "STRIPE_WEBHOOK_SECRET", "")
    resp = client.post("/billing/webhook", content=b"{}", headers={"stripe-signature": "x"})
    assert resp.status_code == 503


def test_billing_webhook_rejects_invalid_signature(monkeypatch):
    _configure_stripe(monkeypatch)
    with patch(
        "app.stripe.Webhook.construct_event",
        side_effect=stripe.error.SignatureVerificationError("bad sig", "sig_header"),
    ):
        resp = client.post("/billing/webhook", content=b"{}", headers={"stripe-signature": "bad"})
    assert resp.status_code == 400


def test_billing_webhook_checkout_completed_records_stripe_customer(monkeypatch):
    _configure_stripe(monkeypatch)
    event = {
        "type": "checkout.session.completed",
        "data": {
            "object": {
                "client_reference_id": "webhook-test-user",
                "customer": "cus_webhook123",
            }
        },
    }
    with patch("app.stripe.Webhook.construct_event", return_value=event):
        resp = client.post("/billing/webhook", content=b"{}", headers={"stripe-signature": "ok"})

    assert resp.status_code == 200
    assert db.get_user_id_by_stripe_customer("cus_webhook123") == "webhook-test-user"


def test_billing_webhook_subscription_updated_sets_plan(monkeypatch):
    _configure_stripe(monkeypatch)
    db.set_stripe_customer("subscription-test-user", "cus_sub123")
    event = {
        "type": "customer.subscription.updated",
        "data": {
            "object": {
                "customer": "cus_sub123",
                "status": "active",
                "items": {"data": [{"price": {"id": "price_pro_fake"}}]},
            }
        },
    }
    with patch("app.stripe.Webhook.construct_event", return_value=event):
        resp = client.post("/billing/webhook", content=b"{}", headers={"stripe-signature": "ok"})

    assert resp.status_code == 200
    assert db.get_or_create_entitlement("subscription-test-user")["plan"] == "pro"


def test_billing_webhook_subscription_updated_ignores_inactive_status(monkeypatch):
    _configure_stripe(monkeypatch)
    db.set_stripe_customer("inactive-sub-user", "cus_inactive123")
    event = {
        "type": "customer.subscription.updated",
        "data": {
            "object": {
                "customer": "cus_inactive123",
                "status": "past_due",
                "items": {"data": [{"price": {"id": "price_pro_fake"}}]},
            }
        },
    }
    with patch("app.stripe.Webhook.construct_event", return_value=event):
        resp = client.post("/billing/webhook", content=b"{}", headers={"stripe-signature": "ok"})

    assert resp.status_code == 200
    assert db.get_or_create_entitlement("inactive-sub-user")["plan"] == "free"


def test_billing_webhook_subscription_deleted_resets_to_free(monkeypatch):
    _configure_stripe(monkeypatch)
    db.set_stripe_customer("cancelling-user", "cus_cancel123")
    db.set_plan("cancelling-user", "max")

    event = {
        "type": "customer.subscription.deleted",
        "data": {"object": {"customer": "cus_cancel123"}},
    }
    with patch("app.stripe.Webhook.construct_event", return_value=event):
        resp = client.post("/billing/webhook", content=b"{}", headers={"stripe-signature": "ok"})

    assert resp.status_code == 200
    assert db.get_or_create_entitlement("cancelling-user")["plan"] == "free"
