"""The app factory every service starts from."""

import os

from fastapi import FastAPI
from fastapi.responses import JSONResponse

from rh_common.db import database_ok
from rh_common.errors import install_error_handlers


def create_app(service: str, **kwargs) -> FastAPI:
    """A FastAPI app with the shared error format and a /health endpoint.

    The gateway serves the app under /api/<service>/ and strips that prefix, so
    routes are declared without it. Routes under /internal/ are for other
    services only: the gateway never forwards them.
    """
    app = FastAPI(
        title=f"RecruteHub {service}",
        root_path=os.environ.get("ROOT_PATH", f"/api/{service}"),
        **kwargs,
    )
    install_error_handlers(app)

    @app.get("/health", tags=["health"])
    def health():
        ok = database_ok()
        return JSONResponse(
            {"service": service, "status": "ok" if ok else "degraded", "database": ok},
            status_code=200 if ok else 503,
        )

    app.state.service = service
    return app
