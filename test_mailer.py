from unittest.mock import patch

import mailer


def _configure(monkeypatch, port: int) -> None:
    monkeypatch.setattr(mailer, "SMTP_HOST", "smtp.example.com")
    monkeypatch.setattr(mailer, "SMTP_PORT", port)
    monkeypatch.setattr(mailer, "SMTP_USER", "user@example.com")
    monkeypatch.setattr(mailer, "SMTP_PASSWORD", "dummy")
    monkeypatch.setattr(mailer, "SMTP_FROM", "no-reply@example.com")


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


def test_port_587_uses_starttls(monkeypatch):
    _configure(monkeypatch, 587)
    with patch("mailer.smtplib.SMTP_SSL") as mock_ssl, patch("mailer.smtplib.SMTP") as mock_plain:
        mailer.send_email("to@example.com", "subject", "body")

    mock_ssl.assert_not_called()
    server = mock_plain.return_value.__enter__.return_value
    server.starttls.assert_called_once()
    server.send_message.assert_called_once()
