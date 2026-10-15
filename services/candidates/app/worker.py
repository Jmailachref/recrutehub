"""Background jobs for the candidates service: sending CVs to the CV analyzer."""

import logging

from app.cv import handle_send_cv
from rh_common.cvanalyzer import cvanalyzer
from rh_common.db import _sessions
from rh_common.queue import run_worker


def send_cv(job: dict) -> None:
    with _sessions()() as db:
        handle_send_cv(job, db, cvanalyzer())


HANDLERS = {"send_cv": send_cv}

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    run_worker("candidates", HANDLERS)
