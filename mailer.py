"""
mailer.py
---------
ログインコードの発行・再発行メールを送るための、最小限のSMTP送信モジュール。

外部のメール配信サービス(SendGrid等)のアカウント登録を必須にしないよう、
標準ライブラリのsmtplibだけで完結させる。Gmailのアプリパスワード等でも動く。

SMTP_HOST等が未設定の場合は実際には送信せず、ログに内容を出力するだけにする
(メールサーバーが無いローカル開発でも、コードの中身を確認しながら動作確認できる)。

RESEND_API_KEYを設定した場合は、SMTPではなくResendのHTTP API(ポート443)で送る。
Renderの無料プランは外部へのSMTPポート(25/465/587)を遮断しているため、その環境用。
"""

from __future__ import annotations

import logging
import os
import smtplib
from email.mime.text import MIMEText

import requests
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

SMTP_HOST = os.getenv("SMTP_HOST", "").strip()
SMTP_PORT = int(os.getenv("SMTP_PORT", "587") or "587")
SMTP_USER = os.getenv("SMTP_USER", "").strip()
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "").strip()
SMTP_FROM = os.getenv("SMTP_FROM", "").strip() or SMTP_USER

RESEND_API_KEY = os.getenv("RESEND_API_KEY", "").strip()
# Resendで認証済みのドメインのアドレス(例: THYNORA <no-reply@krasis.xyz>)。未設定ならSMTP_FROMを使う。
RESEND_FROM = os.getenv("RESEND_FROM", "").strip() or SMTP_FROM
RESEND_API_URL = "https://api.resend.com/emails"


def is_configured() -> bool:
    if RESEND_API_KEY:
        return bool(RESEND_FROM)
    return bool(SMTP_HOST and SMTP_USER and SMTP_PASSWORD)


def _send_via_resend(to: str, subject: str, body: str) -> None:
    resp = requests.post(
        RESEND_API_URL,
        headers={"Authorization": f"Bearer {RESEND_API_KEY}"},
        json={"from": RESEND_FROM, "to": [to], "subject": subject, "text": body},
        timeout=10,
    )
    if not resp.ok:
        # Resendのエラー文(例: ドメインが未認証)は原因の切り分けに必要なのでログに残す。キーは含まれない。
        try:
            reason = resp.json().get("message", "")
        except ValueError:
            reason = ""
        logger.error("Resendでのメール送信に失敗しました: status=%s %s", resp.status_code, reason)
    resp.raise_for_status()


def send_email(to: str, subject: str, body: str) -> None:
    """Resend、またはSMTPの設定があれば実際に送信し、無ければログに出力するだけにする。

    uvicornのデフォルトログ設定はWARNING未満のログを表示しないため、
    ローカル開発時にログでコードを確認できるようwarningレベルで出力する。
    """
    if not is_configured():
        logger.warning(
            "SMTP未設定のためメール送信をスキップしログ出力のみ行います: to=%s subject=%s\n%s",
            to,
            subject,
            body,
        )
        return

    if RESEND_API_KEY:
        _send_via_resend(to, subject, body)
        return

    message = MIMEText(body)
    message["Subject"] = subject
    message["From"] = SMTP_FROM
    message["To"] = to

    # 465番は最初からTLSで接続する方式(SMTPS)。587番などと同じSTARTTLSで接続すると、
    # サーバーに切断される(SMTPServerDisconnected)ため、ポートで接続方式を切り替える。
    if SMTP_PORT == 465:
        server_context = smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, timeout=10)
    else:
        server_context = smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=10)
    with server_context as server:
        if SMTP_PORT != 465:
            server.starttls()
        server.login(SMTP_USER, SMTP_PASSWORD)
        server.send_message(message)
