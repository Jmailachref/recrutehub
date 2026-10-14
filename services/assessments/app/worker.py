"""Background jobs for the assessments service: scoring ended tests."""

import logging

from app.scoring import score_session
from rh_common.codeplay import codeplay
from rh_common.db import _sessions
from rh_common.queue import run_worker


def handle_score_session(job: dict) -> None:
    with _sessions()() as db:
        score_session(job, db, codeplay())


HANDLERS = {"score_session": handle_score_session}

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    run_worker("assessments", HANDLERS)
