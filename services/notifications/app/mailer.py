"""Sends one email over SMTP (Mailpit locally, a real provider in production)."""

import os
import smtplib
from email.message import EmailMessage


def send(to: str, subject: str, body: str) -> None:
    message = EmailMessage()
    message["From"] = os.environ.get("MAIL_FROM", "RecruteHub <no-reply@recrutehub.local>")
    message["To"] = to
    message["Subject"] = subject
    message.set_content(body)
    host, port = os.environ.get("SMTP_HOST", "mailpit"), int(os.environ.get("SMTP_PORT", "1025"))
    with smtplib.SMTP(host, port, timeout=20) as smtp:
        if os.environ.get("SMTP_STARTTLS", "false").lower() == "true":
            smtp.starttls()
        if os.environ.get("SMTP_USER"):
            smtp.login(os.environ["SMTP_USER"], os.environ.get("SMTP_PASSWORD", ""))
        smtp.send_message(message)
