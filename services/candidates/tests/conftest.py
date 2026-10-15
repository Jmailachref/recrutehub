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
from rh_common.cvanalyzer import cvanalyzer  # noqa: E402
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
        if (method, service, path) == ("POST", "auth", "/internal/users/names"):
            return {i: f"User {i[:4]}" for i in kwargs["json"]["ids"]}
        assert (method, service) == ("GET", "offers")
        key = path.rsplit("/", 1)[-1]
        offer = self.offers.get(key) or next((o for o in self.offers.values() if o["id"] == key), None)
        if offer is None:
            raise ApiError(404, "not_found", "Offer not found")
        return {"skills": [{"language": "python", "priority": 1}], **offer}

    def over_limit(self, key, limit, window):
        self.hits[key] = self.hits.get(key, 0) + 1
        return self.limit_hit or self.hits[key] > limit


class FakeAnalyzer:
    """Stands in for the CV analyzer: offers, CVs, their points and highlights."""

    def __init__(self):
        self.offers: dict[str, dict] = {}
        self.documents: dict[str, dict] = {}
        self.marks: dict[str, dict] = {}
        self.down = False

    def _up(self):
        if self.down:
            raise ApiError(502, "cv_analyzer_unavailable", "down")

    def save_offer(self, ref, title, skills, criteria=None, rebuild=False):
        self._up()
        self.offers[ref] = {"title": title, "skills": skills}
        return self.offers[ref]

    def upload(self, offer_ref, external_ref, filename, data):
        self._up()
        if offer_ref not in self.offers:
            raise ApiError(404, "offer_not_found", "no such offer")
        d = {"id": str(uuid.uuid4()), "offer_ref": offer_ref, "external_ref": external_ref, "status": "ready", "auto": 1.5}
        self.documents[d["id"]] = d
        return d

    def document(self, document_id):
        d = self.documents[document_id]
        return {**d, "pages": 1, "ocr_used": False, "error": None,
                "lines": [{"n": 0, "page": 1, "section": "header", "text": "Amina", "start": 0, "end": 5, "bbox": None}]}

    def _manual(self, document_id):
        return sum(h["points"] for h in self.marks.values() if h["document_id"] == document_id)

    def score(self, document_id):
        d, manual = self.documents[document_id], self._manual(document_id)
        criteria = [{"id": "python", "label": "python", "found": True, "points": 1.5, "lines": [0], "matched_terms": ["python"]}]
        return {"auto": d["auto"], "manual": manual, "total": d["auto"] + manual,
                "analysis": {"details": {"gained": 1.5, "penalties": 0, "criteria": criteria}},
                "highlights": [h for h in self.marks.values() if h["document_id"] == document_id]}

    def ranking(self, ref):
        self._up()
        if ref not in self.offers:
            raise ApiError(404, "offer_not_found", "no such offer")
        return [{"document_id": d["id"], "external_ref": d["external_ref"], "status": d["status"],
                 "total": d["auto"] + self._manual(d["id"]), "missing": []}
                for d in self.documents.values() if d["offer_ref"] == ref]

    def add_highlight(self, document_id, body):
        if any(h["quote"] == body.get("quote") for h in self.marks.values() if h["document_id"] == document_id):
            raise ApiError(409, "already_scored", "already scored")
        h = {"id": str(uuid.uuid4()), "document_id": document_id, "boxes": [], **body}
        self.marks[h["id"]] = h
        return h

    def highlights(self, document_id):
        return [h for h in self.marks.values() if h["document_id"] == document_id]

    def delete_highlight(self, highlight_id):
        del self.marks[highlight_id]



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
def analyzer():
    fake = FakeAnalyzer()
    app.dependency_overrides[cvanalyzer] = lambda: fake
    yield fake
    app.dependency_overrides.pop(cvanalyzer, None)


@pytest.fixture
def client(fakes, analyzer):
    return TestClient(app)


def apply(client, token="open", name="Amina Haddad", email="amina@acme.com", cv=PDF, **extra):
    return client.post(
        f"/apply/{token}",
        data={"name": name, "email": email, **extra},
        files={"cv": ("cv.pdf", cv, "application/pdf")},
    )
