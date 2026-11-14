from unittest.mock import patch

import mailer


def _configure(monkeypatch, port: int) -> None:
    monkeypatch.setattr(mailer, "SMTP_HOST", "smtp.example.com")
    monkeypatch.setattr(mailer, "SMTP_PORT", port)
    monkeypatch.setattr(mailer, "SMTP_USER", "user@example.com")
    monkeypatch.setattr(mailer, "SMTP_PASSWORD", "dummy")
    monkeypatch.setattr(mailer, "SMTP_FROM", "no-reply@example.com")
    monkeypatch.setattr(mailer, "RESEND_API_KEY", "")


def test_port_465_uses_implicit_tls_without_starttls(monkeypatch):
    """465番(SMTPS)では最初からTLSで接続し、STARTTLSを送らない回帰テスト
    (STARTTLSで接続するとサーバーに切断され、ログインコードのメールが届かなかった)。"""
    _configure(monkeypatch, 465)
    with patch("mailer.smtplib.SMTP_SSL") as mock_ssl, patch("mailer.smtplib.SMTP") as mock_plain:
        mailer.send_email("to@example.com", "subject", "body")

    mock_plain.assert_not_called()
    server = mock_ssl.return_value.__enter__.return_value
    server.starttls.assert_not_called()
    server.login.assert_called_once()
    server.send_message.assert_called_once()


def test_resend_api_key_sends_over_https_instead_of_smtp(monkeypatch):
    """RESEND_API_KEYがあれば、SMTP(Renderの無料プランでは遮断される)を使わず、
    ResendのHTTP APIで送る回帰テスト。"""
    _configure(monkeypatch, 587)
    monkeypatch.setattr(mailer, "RESEND_API_KEY", "re_dummy")
    monkeypatch.setattr(mailer, "RESEND_FROM", "THYNORA <no-reply@example.com>")
    with patch("mailer.requests.post") as mock_post, patch("mailer.smtplib.SMTP") as mock_plain:
        mock_post.return_value.ok = True
        mailer.send_email("to@example.com", "subject", "body")

    mock_plain.assert_not_called()
    url = mock_post.call_args.args[0]
    kwargs = mock_post.call_args.kwargs
    assert url == mailer.RESEND_API_URL
    assert kwargs["headers"]["Authorization"] == "Bearer re_dummy"
    assert kwargs["json"] == {
        "from": "THYNORA <no-reply@example.com>",
        "to": ["to@example.com"],
        "subject": "subject",
        "text": "body",
    }
    mock_post.return_value.raise_for_status.assert_called_once()


def test_resend_counts_as_configured_without_smtp(monkeypatch):
    monkeypatch.setattr(mailer, "SMTP_HOST", "")
    monkeypatch.setattr(mailer, "RESEND_API_KEY", "re_dummy")
    monkeypatch.setattr(mailer, "RESEND_FROM", "no-reply@example.com")
    assert mailer.is_configured()


def test_port_587_uses_starttls(monkeypatch):
    _configure(monkeypatch, 587)
    with patch("mailer.smtplib.SMTP_SSL") as mock_ssl, patch("mailer.smtplib.SMTP") as mock_plain:
        mailer.send_email("to@example.com", "subject", "body")

    mock_ssl.assert_not_called()
    server = mock_plain.return_value.__enter__.return_value
    server.starttls.assert_called_once()
    server.send_message.assert_called_once()
