import os
import tempfile
import time
import uuid

_tmp = tempfile.mkdtemp()
os.environ["DATABASE_URL"] = f"sqlite:///{_tmp}/offers.db"

import jwt  # noqa: E402
import pytest  # noqa: E402
from cryptography.hazmat.primitives.asymmetric import rsa  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402
from rh_common import ApiError, tokens  # noqa: E402
from rh_common.codeplay import codeplay  # noqa: E402
from rh_common.cvanalyzer import cvanalyzer  # noqa: E402
from rh_common.db import Base, engine  # noqa: E402
from rh_common.library import library  # noqa: E402

KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
tokens.use_local_key(KEY.public_key())

ACME = uuid.uuid4()
GLOBEX = uuid.uuid4()


def token(role="recruiter", tenant=ACME, sub=None) -> dict:
    claims = {
        "sub": sub or str(uuid.uuid4()),
        "role": role,
        "iss": tokens.ISSUER,
        "exp": int(time.time()) + 600,
    }
    if tenant is not None:
        claims["tenant_id"] = str(tenant)
    return {"Authorization": f"Bearer {jwt.encode(claims, KEY, algorithm='RS256')}"}


class FakeBank:
    def __init__(self):
        self.rows = [
            {"language": "python", "level": 5, "code": 6, "qcm": 3},
            {"language": "python", "level": 1, "code": 2, "qcm": 2},
            {"language": "sql", "level": 3, "code": 4, "qcm": 0},
            {"language": "docker", "level": 2, "code": 0, "qcm": 8},
        ]

    def stock(self, language=None):
        return [r for r in self.rows if language in (None, r["language"])]


class FakeLibrary:
    """The company's own questions: tenant → [{language, level, count}]."""

    def __init__(self):
        self.rows: dict = {}

    def stock(self, tenant_id):
        return self.rows.get(tenant_id, [])


class FakeAnalyzer:
    """Stands in for the CV analyzer: keeps each offer's grid, one criterion per skill."""

    def __init__(self):
        self.offers: dict[str, dict] = {}
        self.down = False

    def save_offer(self, ref, title, skills, criteria=None, rebuild=False):
        if self.down:
            raise ApiError(502, "cv_analyzer_unavailable", "down")
        old = self.offers.get(ref)
        if criteria is None and (old is None or rebuild):
            criteria = [{"id": s["language"], "label": s["language"], "terms": [], "default_synonyms": True,
                         "points_present": 1.0, "points_absent": -20.0 if s["priority"] == 1 else 0.0} for s in skills]
        elif criteria is None:
            criteria = old["criteria"]
        version = (old["grid_version"] + (old["criteria"] != criteria)) if old else 1
        self.offers[ref] = {"external_ref": ref, "title": title, "skills": skills, "criteria": criteria, "grid_version": version}
        return self.offers[ref]

    def offer(self, ref):
        if ref not in self.offers:
            raise ApiError(404, "offer_not_found", "no such offer")
        return self.offers[ref]

    def delete_offer(self, ref):
        if self.offers.pop(ref, None) is None:
            raise ApiError(404, "offer_not_found", "no such offer")


@pytest.fixture(autouse=True)
def fresh_db():
    Base.metadata.drop_all(engine())
    Base.metadata.create_all(engine())
    yield


@pytest.fixture
def bank():
    fake = FakeBank()
    app.dependency_overrides[codeplay] = lambda: fake
    yield fake
    app.dependency_overrides.clear()


@pytest.fixture
def analyzer():
    fake = FakeAnalyzer()
    app.dependency_overrides[cvanalyzer] = lambda: fake
    yield fake
    app.dependency_overrides.pop(cvanalyzer, None)


@pytest.fixture
def lib():
    fake = FakeLibrary()
    app.dependency_overrides[library] = lambda: fake
    yield fake
    app.dependency_overrides.pop(library, None)


@pytest.fixture
def client(bank, analyzer, lib):
    return TestClient(app)
