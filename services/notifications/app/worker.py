"""Background jobs for the notifications service. Job handlers are added as features land."""

import logging

from rh_common.queue import run_worker

HANDLERS: dict = {}

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    run_worker("notifications", HANDLERS)
