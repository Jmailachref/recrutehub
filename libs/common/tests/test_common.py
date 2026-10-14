import time
from uuid import uuid4

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import Depends
from fastapi.testclient import TestClient

from rh_common import ApiError, Principal, create_app, require_role
from rh_common import db, tokens

KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)


def make_token(**claims) -> str:
    body = {"sub": "u1", "role": "recruiter", "iss": tokens.ISSUER, "exp": int(time.time()) + 60, **claims}
    return jwt.encode(body, KEY, algorithm="RS256")


@pytest.fixture
def app(monkeypatch, tmp_path):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path}/t.db")
    db.engine.cache_clear()
    monkeypatch.setattr(tokens, "signing_key", lambda _token: KEY.public_key())
    app = create_app("offers")

    @app.get("/mine")
    def mine(p: Principal = Depends(require_role("recruiter", "admin"))):
        return {"sub": p.sub, "tenant": str(p.tenant_id)}

    @app.get("/boom")
    def boom():
        raise ApiError(409, "conflict", "Already exists")

    yield TestClient(app)
    db.engine.cache_clear()


def test_health_reports_database(app):
    r = app.get("/health")
    assert r.status_code == 200
    assert r.json() == {"service": "offers", "status": "ok", "database": True}


def test_valid_token_gives_principal(app):
    tenant = uuid4()
    r = app.get("/mine", headers={"Authorization": f"Bearer {make_token(tenant_id=str(tenant))}"})
    assert r.status_code == 200
    assert r.json() == {"sub": "u1", "tenant": str(tenant)}


@pytest.mark.parametrize(
    "header",
    [None, "Bearer nonsense", f"Bearer {make_token(exp=int(time.time()) - 10)}", f"Bearer {make_token(iss='other')}"],
)
def test_bad_tokens_are_401(app, header):
    r = app.get("/mine", headers={"Authorization": header} if header else {})
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "unauthorized"


def test_token_from_cookie(app):
    app.cookies.set("rh_access", make_token())
    assert app.get("/mine").status_code == 200


def test_wrong_role_is_403(app):
    r = app.get("/mine", headers={"Authorization": f"Bearer {make_token(role='candidate')}"})
    assert r.status_code == 403
    assert r.json()["error"]["code"] == "forbidden"


def test_errors_use_shared_format(app):
    assert app.get("/boom").json() == {"error": {"code": "conflict", "message": "Already exists"}}
    assert app.get("/missing").json()["error"]["code"] == "not_found"
