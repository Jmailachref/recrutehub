"""Redis job queues. A job is a JSON object with a "type"; a worker maps types to handlers."""

import json
import logging
import os
from collections.abc import Callable
from functools import lru_cache

import redis

log = logging.getLogger(__name__)


@lru_cache
def client() -> redis.Redis:
    # The socket timeout must outlast the blocking BRPOP in run_worker.
    return redis.Redis.from_url(os.environ["REDIS_URL"], socket_timeout=30)


def enqueue(queue: str, job_type: str, **payload) -> None:
    client().lpush(f"rh:queue:{queue}", json.dumps({"type": job_type, **payload}))


def run_worker(queue: str, handlers: dict[str, Callable[[dict], None]], once: bool = False) -> None:
    """Takes jobs off the queue forever. A failing job is logged and skipped."""
    key = f"rh:queue:{queue}"
    log.info("worker listening on %s for %s", key, sorted(handlers) or "no job types yet")
    while True:
        item = client().brpop([key], timeout=5)
        if item is not None:
            job = json.loads(item[1])
            handler = handlers.get(job.get("type"))
            if handler is None:
                log.warning("no handler for job %s", job)
            else:
                try:
                    handler(job)
                except Exception:
                    log.exception("job failed: %s", job)
        if once:
            return
