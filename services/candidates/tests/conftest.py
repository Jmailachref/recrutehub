import os
import tempfile
import time
import uuid

_tmp = tempfile.mkdtemp()
os.environ["DATABASE_URL"] = f"sqlite:///{_tmp}/candidates.db"

import jwt  # noqa: E402
import pytest  # noqa: E402
from cryptography.hazmat.primitives.asymmetric import rsa  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app import storage  # noqa: E402
from app.main import app  # noqa: E402
from rh_common import ApiError, internal, queue, tokens  # noqa: E402
from rh_common.db import Base, engine  # noqa: E402

KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
tokens.use_local_key(KEY.public_key())

ACME = uuid.uuid4()
GLOBEX = uuid.uuid4()
PDF = b"%PDF-1.7\n1 0 obj << >> endobj\n%%EOF\n"


def token(role="recruiter", tenant=ACME) -> dict:
    claims = {"sub": str(uuid.uuid4()), "role": role, "iss": tokens.ISSUER, "exp": int(time.time()) + 600}
    if tenant is not None:
        claims["tenant_id"] = str(tenant)
    return {"Authorization": f"Bearer {jwt.encode(claims, KEY, algorithm='RS256')}"}


class Fakes:
    """Stands in for the offers service, the bucket, Redis queues and rate limits."""

    def __init__(self):
        self.offers = {
            "open": {"id": str(uuid.uuid4()), "tenant_id": str(ACME), "title": "Backend developer", "status": "active"},
            "draft": {"id": str(uuid.uuid4()), "tenant_id": str(ACME), "title": "Draft", "status": "draft"},
            "globex": {"id": str(uuid.uuid4()), "tenant_id": str(GLOBEX), "title": "Data engineer", "status": "active"},
        }
        self.files: dict[str, bytes] = {}
        self.jobs: list[tuple] = []
        self.hits: dict[str, int] = {}
        self.limit_hit = False

    def call(self, method, service, path, **kwargs):
        assert (method, service) == ("GET", "offers")
        offer = self.offers.get(path.rsplit("/", 1)[-1])
        if offer is None:
            raise ApiError(404, "not_found", "Offer not found")
        return offer

    def over_limit(self, key, limit, window):
        self.hits[key] = self.hits.get(key, 0) + 1
        return self.limit_hit or self.hits[key] > limit


@pytest.fixture(autouse=True)
def fresh_db():
    Base.metadata.drop_all(engine())
    Base.metadata.create_all(engine())
    yield


@pytest.fixture
def fakes(monkeypatch):
    f = Fakes()
    monkeypatch.setattr(internal, "call", f.call)
    monkeypatch.setattr(queue, "over_limit", f.over_limit)
    monkeypatch.setattr(queue, "enqueue", lambda q, t, **p: f.jobs.append((q, t, p)))
    monkeypatch.setattr(storage, "put_pdf", lambda k, d: f.files.__setitem__(k, d))
    monkeypatch.setattr(storage, "get_pdf", lambda k: f.files[k])
    monkeypatch.setattr(storage, "delete", lambda k: f.files.pop(k, None))
    return f


@pytest.fixture
def client(fakes):
    return TestClient(app)


def apply(client, token="open", name="Amina Haddad", email="amina@acme.com", cv=PDF, **extra):
    return client.post(
        f"/apply/{token}",
        data={"name": name, "email": email, **extra},
        files={"cv": ("cv.pdf", cv, "application/pdf")},
    )
