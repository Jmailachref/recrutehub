"""Calls between services: GET/POST on another service's /internal/ routes.

Each call carries a short-lived service token, which auth gives in exchange
for SERVICE_SECRET. The token is cached until shortly before it expires.
"""

import os
import threading
import time

import httpx

from rh_common.errors import ApiError

_lock = threading.Lock()
_cached: tuple[str, float] | None = None
SERVICE_NAME = os.environ.get("SERVICE_NAME", "unknown")


def service_token() -> str:
    global _cached
    with _lock:
        if _cached and _cached[1] > time.time() + 30:
            return _cached[0]
        response = httpx.post(
            f"{os.environ.get('AUTH_URL', 'http://auth:8000')}/internal/service-token",
            headers={"X-Service-Name": SERVICE_NAME, "X-Service-Secret": os.environ.get("SERVICE_SECRET", "")},
            timeout=10,
        )
        response.raise_for_status()
        body = response.json()
        _cached = (body["token"], time.time() + body["expires_in"])
        return _cached[0]


def call(method: str, service: str, path: str, **kwargs):
    """Calls http://<service>:8000<path> as this service. Errors keep their status and code."""
    try:
        response = httpx.request(
            method,
            f"http://{service}:8000{path}",
            headers={"Authorization": f"Bearer {service_token()}"},
            timeout=15,
            **kwargs,
        )
    except httpx.HTTPError as exc:
        raise ApiError(502, "service_unavailable", f"The {service} service is not reachable") from exc
    if response.status_code >= 400:
        error = (response.json().get("error") or {}) if response.content else {}
        status = response.status_code if response.status_code < 500 else 502
        raise ApiError(status, error.get("code", "service_error"), error.get("message", f"{service} failed"))
    return response.json() if response.content else None
