import time
import uuid

import jwt
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient

from app import mailer
from app.main import app
from app.worker import send_email
from rh_common import tokens

TENANT = str(uuid.uuid4())
JOB = {
    "type": "send_email",
    "template": "application_received",
    "to": "amina@example.com",
    "tenant_id": TENANT,
    "data": {"name": "Amina", "offer_title": "Backend developer"},
}


def test_sends_and_logs(monkeypatch):
    sent = []
    monkeypatch.setattr(mailer, "send", lambda to, subject, body: sent.append((to, subject, body)))
    entry = send_email(JOB, sleep=lambda s: None)
    assert entry.status == "sent" and entry.attempts == 1
    to, subject, body = sent[0]
    assert to == "amina@example.com" and "Backend developer" in subject and "Hello Amina" in body


def test_retries_then_gives_up(monkeypatch):
    calls, slept = [], []

    def fail(*args):
        calls.append(1)
        raise ConnectionRefusedError("smtp down")

    monkeypatch.setattr(mailer, "send", fail)
    entry = send_email(JOB, sleep=slept.append)
    assert entry.status == "failed" and entry.attempts == 4 and "smtp down" in entry.error
    assert slept == [0, 2, 8, 32]


def test_recovers_after_a_failure(monkeypatch):
    attempts = iter([ConnectionRefusedError("down"), None])

    def flaky(*args):
        error = next(attempts)
        if error:
            raise error

    monkeypatch.setattr(mailer, "send", flaky)
    entry = send_email(JOB, sleep=lambda s: None)
    assert entry.status == "sent" and entry.attempts == 2 and entry.error is None


def test_invite_template_has_the_link(monkeypatch):
    sent = []
    monkeypatch.setattr(mailer, "send", lambda to, subject, body: sent.append(body))
    send_email(
        {**JOB, "template": "test_invite", "data": {"name": "A", "offer_title": "T", "link": "https://x/test/abc"}},
        sleep=lambda s: None,
    )
    assert "https://x/test/abc" in sent[0]


def test_admin_sees_own_company_emails_only(monkeypatch):
    monkeypatch.setattr(mailer, "send", lambda *a: None)
    send_email(JOB, sleep=lambda s: None)
    send_email({**JOB, "tenant_id": str(uuid.uuid4())}, sleep=lambda s: None)
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    tokens.use_local_key(key.public_key())

    def headers(role):
        claims = {"sub": "u", "role": role, "tenant_id": TENANT, "iss": tokens.ISSUER, "exp": int(time.time()) + 60}
        return {"Authorization": f"Bearer {jwt.encode(claims, key, algorithm='RS256')}"}

    client = TestClient(app)
    emails = client.get("/emails", headers=headers("admin")).json()
    assert [e["to"] for e in emails] == ["amina@example.com"]
    assert client.get("/emails", headers=headers("recruiter")).status_code == 403
