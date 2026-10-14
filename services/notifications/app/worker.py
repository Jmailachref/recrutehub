"""Sends the emails other services queue on "notifications".

Job: {"type": "send_email", "template": ..., "to": ..., "tenant_id": ..., "data": {...}}.
A failed send is retried 3 times (after 2, 8 and 32 seconds) before it is marked failed.
"""

import logging
import time
import uuid
from datetime import UTC, datetime

from app import mailer
from app.models import EmailLog
from app.templates import TEMPLATES
from rh_common.db import _sessions
from rh_common.queue import run_worker

log = logging.getLogger(__name__)
RETRY_DELAYS = (2, 8, 32)


def send_email(job: dict, sleep=time.sleep) -> EmailLog:
    subject, body = TEMPLATES[job["template"]](job.get("data", {}))
    with _sessions()() as db:
        entry = EmailLog(
            tenant_id=uuid.UUID(job["tenant_id"]) if job.get("tenant_id") else None,
            template=job["template"],
            to=job["to"],
            subject=subject,
            data=job.get("data", {}),
        )
        db.add(entry)
        db.commit()
        for delay in (0, *RETRY_DELAYS):
            sleep(delay)
            entry.attempts += 1
            try:
                mailer.send(job["to"], subject, body)
            except Exception as exc:
                entry.error = f"{type(exc).__name__}: {exc}"
                log.warning("email %s to %s failed (attempt %d): %s", entry.id, entry.to, entry.attempts, exc)
                db.commit()
                continue
            entry.status, entry.sent_at, entry.error = "sent", datetime.now(UTC), None
            db.commit()
            return entry
        entry.status = "failed"
        db.commit()
        return entry


HANDLERS = {"send_email": send_email}

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    run_worker("notifications", HANDLERS)
