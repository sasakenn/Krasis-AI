"""
mailer.py
---------
ログインコードの発行・再発行メールを送るための、最小限のSMTP送信モジュール。

外部のメール配信サービス(SendGrid等)のアカウント登録を必須にしないよう、
標準ライブラリのsmtplibだけで完結させる。Gmailのアプリパスワード等でも動く。

SMTP_HOST等が未設定の場合は実際には送信せず、ログに内容を出力するだけにする
(メールサーバーが無いローカル開発でも、コードの中身を確認しながら動作確認できる)。
"""

from __future__ import annotations

import logging
import os
import smtplib
from email.mime.text import MIMEText

from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

SMTP_HOST = os.getenv("SMTP_HOST", "").strip()
SMTP_PORT = int(os.getenv("SMTP_PORT", "587") or "587")
SMTP_USER = os.getenv("SMTP_USER", "").strip()
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "").strip()
SMTP_FROM = os.getenv("SMTP_FROM", "").strip() or SMTP_USER


def is_configured() -> bool:
    return bool(SMTP_HOST and SMTP_USER and SMTP_PASSWORD)


def send_email(to: str, subject: str, body: str) -> None:
    """SMTP設定があれば実際に送信し、無ければログに出力するだけにする。

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

    message = MIMEText(body)
    message["Subject"] = subject
    message["From"] = SMTP_FROM
    message["To"] = to

    with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=10) as server:
        server.starttls()
        server.login(SMTP_USER, SMTP_PASSWORD)
        server.send_message(message)
