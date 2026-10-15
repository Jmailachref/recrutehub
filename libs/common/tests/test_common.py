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


def test_validator_errors_are_reported_as_400(monkeypatch, tmp_path):
    from pydantic import BaseModel, model_validator

    class Body(BaseModel):
        n: int

        @model_validator(mode="after")
        def positive(self):
            if self.n < 0:
                raise ValueError("n must be positive")
            return self

    app = create_app("offers")

    @app.post("/n")
    def n(body: Body):
        return body

    r = TestClient(app).post("/n", json={"n": -1})
    assert r.status_code == 400 and "n must be positive" in r.text


def test_errors_use_shared_format(app):
    assert app.get("/boom").json() == {"error": {"code": "conflict", "message": "Already exists"}}
    assert app.get("/missing").json()["error"]["code"] == "not_found"


def test_cv_analyzer_client_speaks_its_api():
    import httpx

    from rh_common.cvanalyzer import CvAnalyzer

    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append((request.method, request.url.path, request.headers["authorization"], request.content))
        if request.url.path == "/v1/offers/missing":
            return httpx.Response(404, json={"error": {"code": "offer_not_found", "message": "no offer"}})
        if request.url.path == "/v1/offers/broken":
            return httpx.Response(500, json={"error": {"code": "internal", "message": "boom"}})
        return httpx.Response(200, json={"ok": True})

    cva = CvAnalyzer("http://cva", "key", transport=httpx.MockTransport(handler))
    cva.save_offer("o1", "Dev", [{"language": "python", "priority": 1}])
    assert seen[-1][:3] == ("PUT", "/v1/offers/o1", "Bearer key")
    assert b'"skills":[{"name":"python","priority":1}]' in seen[-1][3] and b"criteria" not in seen[-1][3]
    cva.save_offer("o1", "Dev", [], rebuild=True)
    assert b'"rebuild":true' in seen[-1][3]
    with pytest.raises(ApiError) as missing:
        cva.offer("missing")
    assert (missing.value.status, missing.value.code) == (404, "offer_not_found")
    with pytest.raises(ApiError) as broken:
        cva.offer("broken")
    assert (broken.value.status, broken.value.code) == (502, "cv_analyzer_error")

    def down(request):
        raise httpx.ConnectError("refused")

    with pytest.raises(ApiError) as unreachable:
        CvAnalyzer("http://cva", "key", transport=httpx.MockTransport(down)).ranking("o1")
    assert unreachable.value.code == "cv_analyzer_unavailable"
