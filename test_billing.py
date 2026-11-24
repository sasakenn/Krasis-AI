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


def test_checkout_switches_existing_stripe_subscription_instead_of_creating_another(monkeypatch):
    """Proで契約中にMaxを選んだら、新しい契約(二重課金)ではなく今の契約の料金を差し替える。"""
    _configure_stripe(monkeypatch)
    db.set_stripe_customer(DEFAULT_TEST_USER_ID, "cus_upgrade")
    db.set_plan(DEFAULT_TEST_USER_ID, "pro", "stripe")
    subscription = {"id": "sub_1", "items": {"data": [{"id": "si_1", "price": {"id": "price_pro_fake"}}]}}

    with patch("app.stripe.Subscription.list", return_value=MagicMock(data=[subscription])), \
            patch("app.stripe.Subscription.modify") as mock_modify, \
            patch("app.stripe.checkout.Session.create") as mock_checkout:
        resp = client.post("/billing/checkout", json={"plan": "max"})

    assert resp.status_code == 200
    assert resp.json() == {"changed": True}
    mock_checkout.assert_not_called()
    assert mock_modify.call_args.args[0] == "sub_1"
    assert mock_modify.call_args.kwargs["items"] == [{"id": "si_1", "price": "price_max_fake"}]


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


# --- DELETE /me (アカウント削除) ---


def test_delete_me_requires_auth():
    resp = client.delete("/me", headers={"X-Dev-User-Id": ""})
    assert resp.status_code == 401


def test_delete_me_removes_user_data():
    user_id = "dev:delete-me-user"
    db.upsert_user(user_id, "delete@example.com")
    db.get_or_create_entitlement(user_id)
    resp = client.delete("/me", headers={"X-Dev-User-Id": user_id})
    assert resp.status_code == 200
    assert resp.json() == {"deleted": True}
    assert db.get_user_email(user_id) is None
    with db._connect() as conn:
        assert conn.execute("SELECT 1 FROM entitlements WHERE user_id = ?", (user_id,)).fetchone() is None


def test_delete_me_cancels_stripe_subscriptions_first(monkeypatch):
    _configure_stripe(monkeypatch)
    user_id = "dev:delete-me-paid"
    db.upsert_user(user_id, None)
    db.get_or_create_entitlement(user_id)
    db.set_stripe_customer(user_id, "cus_fake")
    sub = MagicMock(id="sub_1")
    listing = MagicMock()
    listing.auto_paging_iter.return_value = [sub]
    with patch.object(app_module.stripe.Subscription, "list", return_value=listing), patch.object(
        app_module.stripe.Subscription, "cancel"
    ) as cancel:
        resp = client.delete("/me", headers={"X-Dev-User-Id": user_id})
    assert resp.status_code == 200
    cancel.assert_called_with("sub_1")


def test_delete_me_keeps_data_when_stripe_cancel_fails(monkeypatch):
    _configure_stripe(monkeypatch)
    user_id = "dev:delete-me-stripe-fail"
    db.upsert_user(user_id, "keep@example.com")
    db.get_or_create_entitlement(user_id)
    db.set_stripe_customer(user_id, "cus_fake")
    with patch.object(app_module.stripe.Subscription, "list", side_effect=stripe.error.APIError("boom")):
        resp = client.delete("/me", headers={"X-Dev-User-Id": user_id})
    assert resp.status_code == 502
    assert db.get_user_email(user_id) == "keep@example.com"


# --- /billing/revenuecat/webhook (Apple アプリ内課金) ---

RC_AUTH = "rc-test-secret"


def _rc_event(event_type, user_id, product_id="com.thynora.app.pro.monthly"):
    return {"event": {"type": event_type, "app_user_id": user_id, "product_id": product_id}}


def _post_rc(monkeypatch, payload, auth=RC_AUTH):
    monkeypatch.setattr(app_module, "REVENUECAT_WEBHOOK_AUTH", RC_AUTH)
    return client.post("/billing/revenuecat/webhook", json=payload, headers={"Authorization": auth})


def test_revenuecat_webhook_returns_503_when_not_configured(monkeypatch):
    monkeypatch.setattr(app_module, "REVENUECAT_WEBHOOK_AUTH", "")
    resp = client.post("/billing/revenuecat/webhook", json=_rc_event("INITIAL_PURCHASE", "x"))
    assert resp.status_code == 503


def test_revenuecat_webhook_rejects_wrong_authorization(monkeypatch):
    resp = _post_rc(monkeypatch, _rc_event("INITIAL_PURCHASE", "x"), auth="wrong")
    assert resp.status_code == 401


def test_revenuecat_webhook_rejects_malformed_payload(monkeypatch):
    resp = _post_rc(monkeypatch, {"nope": 1})
    assert resp.status_code == 400


def test_revenuecat_webhook_ignores_unknown_user(monkeypatch):
    resp = _post_rc(monkeypatch, _rc_event("INITIAL_PURCHASE", "apple:does-not-exist"))
    assert resp.status_code == 200
    assert resp.json() == {"status": "ignored"}


def test_revenuecat_purchase_grants_plan_and_expiration_reverts_it(monkeypatch):
    user_id = "dev:rc-user"
    db.upsert_user(user_id, None)
    assert _post_rc(monkeypatch, _rc_event("INITIAL_PURCHASE", user_id)).status_code == 200
    ent = db.get_or_create_entitlement(user_id)
    assert (ent["plan"], ent["plan_source"]) == ("pro", "apple")

    _post_rc(monkeypatch, _rc_event("PRODUCT_CHANGE", user_id, "com.thynora.app.max.monthly"))
    assert db.get_or_create_entitlement(user_id)["plan"] == "max"

    _post_rc(monkeypatch, _rc_event("CANCELLATION", user_id))
    assert db.get_or_create_entitlement(user_id)["plan"] == "max"  # 期間終了までは有効

    _post_rc(monkeypatch, _rc_event("EXPIRATION", user_id))
    assert db.get_or_create_entitlement(user_id)["plan"] == "free"


def test_revenuecat_product_change_uses_the_new_product(monkeypatch):
    """RevenueCatのPRODUCT_CHANGEは、product_idに変更前、new_product_idに変更後の商品が入る。"""
    user_id = "dev:rc-upgrade-user"
    db.upsert_user(user_id, None)
    db.set_plan(user_id, "pro", "apple")
    payload = _rc_event("PRODUCT_CHANGE", user_id, "com.thynora.app.pro.monthly")
    payload["event"]["new_product_id"] = "com.thynora.app.max.monthly"
    assert _post_rc(monkeypatch, payload).status_code == 200
    assert db.get_or_create_entitlement(user_id)["plan"] == "max"


def test_revenuecat_expiration_does_not_touch_stripe_plan(monkeypatch):
    user_id = "dev:rc-stripe-user"
    db.upsert_user(user_id, None)
    db.set_plan(user_id, "pro", "stripe")
    _post_rc(monkeypatch, _rc_event("EXPIRATION", user_id))
    assert db.get_or_create_entitlement(user_id)["plan"] == "pro"


def test_stripe_cancellation_does_not_revert_apple_plan(monkeypatch):
    _configure_stripe(monkeypatch)
    user_id = "dev:apple-and-stripe"
    db.upsert_user(user_id, None)
    db.set_stripe_customer(user_id, "cus_apple_mix")
    db.set_plan(user_id, "pro", "apple")
    event = {"type": "customer.subscription.deleted", "data": {"object": {"customer": "cus_apple_mix"}}}
    with patch.object(app_module.stripe.Webhook, "construct_event", return_value=event):
        resp = client.post("/billing/webhook", content=b"{}", headers={"stripe-signature": "t"})
    assert resp.status_code == 200
    assert db.get_or_create_entitlement(user_id)["plan"] == "pro"


# --- /billing/revenuecat/sync (購入直後の問い合わせ) ---


def _rc_subscriber(expires_by_product):
    return {"subscriber": {"subscriptions": {
        product: {"expires_date": expires, "refunded_at": None} for product, expires in expires_by_product.items()
    }}}


def test_revenuecat_sync_applies_the_highest_active_plan(monkeypatch):
    monkeypatch.setattr(app_module, "REVENUECAT_API_KEY", "appl_test")
    future = "2999-01-01T00:00:00Z"
    with patch("app.requests.get") as mock_get:
        mock_get.return_value.json.return_value = _rc_subscriber({
            "com.thynora.app.pro.monthly": future,
            "com.thynora.app.max.monthly": future,
        })
        resp = client.post("/billing/revenuecat/sync")
    assert resp.status_code == 200
    assert resp.json()["plan"] == "max"
    ent = db.get_or_create_entitlement(DEFAULT_TEST_USER_ID)
    assert (ent["plan"], ent["plan_source"]) == ("max", "apple")


def test_revenuecat_sync_reverts_expired_apple_plan_but_not_stripe(monkeypatch):
    monkeypatch.setattr(app_module, "REVENUECAT_API_KEY", "appl_test")
    expired = {"com.thynora.app.pro.monthly": "2000-01-01T00:00:00Z"}

    db.set_plan(DEFAULT_TEST_USER_ID, "pro", "apple")
    with patch("app.requests.get") as mock_get:
        mock_get.return_value.json.return_value = _rc_subscriber(expired)
        client.post("/billing/revenuecat/sync")
    assert db.get_or_create_entitlement(DEFAULT_TEST_USER_ID)["plan"] == "free"

    db.set_plan(DEFAULT_TEST_USER_ID, "pro", "stripe")
    with patch("app.requests.get") as mock_get:
        mock_get.return_value.json.return_value = _rc_subscriber(expired)
        client.post("/billing/revenuecat/sync")
    assert db.get_or_create_entitlement(DEFAULT_TEST_USER_ID)["plan"] == "pro"


def test_revenuecat_sync_returns_503_without_api_key(monkeypatch):
    monkeypatch.setattr(app_module, "REVENUECAT_API_KEY", "")
    assert client.post("/billing/revenuecat/sync").status_code == 503
