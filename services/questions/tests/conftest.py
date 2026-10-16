import os
import tempfile
import time
import uuid

_tmp = tempfile.mkdtemp()
os.environ["DATABASE_URL"] = f"sqlite:///{_tmp}/questions.db"

import jwt  # noqa: E402
import pytest  # noqa: E402
from cryptography.hazmat.primitives.asymmetric import rsa  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

from app.main import TECH_DOMAIN, app, directory  # noqa: E402
from app.models import Domain, Skill  # noqa: E402
from rh_common import tokens  # noqa: E402
from rh_common.codeplay import codeplay  # noqa: E402
from rh_common.db import Base, engine  # noqa: E402

KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
tokens.use_local_key(KEY.public_key())

ACME = uuid.uuid4()
GLOBEX = uuid.uuid4()


def token(sub: uuid.UUID, role="recruiter", tenant=ACME) -> dict:
    claims = {"sub": str(sub), "role": role, "iss": tokens.ISSUER, "exp": int(time.time()) + 600}
    if tenant is not None:
        claims["tenant_id"] = str(tenant)
    return {"Authorization": f"Bearer {jwt.encode(claims, KEY, algorithm='RS256')}"}


class FakeDirectory:
    """The company's employees: id → {name, role, experience}."""

    def __init__(self):
        self.people: dict[uuid.UUID, dict] = {}

    def add(self, name, role="recruiter", experience=1, tenant=ACME) -> uuid.UUID:
        uid = uuid.uuid4()
        self.people[uid] = {"id": str(uid), "name": name, "role": role, "experience": experience, "tenant_id": str(tenant)}
        return uid

    def profiles(self, ids):
        return {i: self.people[i] for i in ids if i in self.people}


QCM_ID, CODE_ID = "11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"
BANK = {
    QCM_ID: {"id": QCM_ID, "slug": "py-closures", "title": "Late-binding closures", "kind": "qcm", "language": "python",
             "level": 3, "status": "approved", "statement": "What prints?", "choices": ["[0, 1, 2]", "[2, 2, 2]"],
             "correct_choices": [1], "starter_code": None, "scenarios": [], "timer_seconds": 60},
    CODE_ID: {"id": CODE_ID, "slug": "py-sum", "title": "Sum", "kind": "code", "language": "python", "level": 3,
              "status": "approved", "statement": "Add", "choices": None, "correct_choices": None, "starter_code": "# go",
              "timer_seconds": 600,
              "scenarios": [{"name": "ex", "input": "1 2", "expected_output": "3", "hidden": False},
                            {"name": "h", "input": "5 5", "expected_output": "10", "hidden": True}]},
}


class FakeBank:
    def stock(self, language=None):
        return [{"language": "python", "level": 3, "code": 2, "qcm": 2}, {"language": "rust", "level": 1, "code": 1, "qcm": 0}]

    def problems(self, language, level=None):
        return [q for q in BANK.values() if q["language"] == language and level in (None, q["level"])]

    def problem_full(self, problem_id):
        from rh_common import ApiError

        if problem_id not in BANK:
            raise ApiError(404, "not_found", "no such problem")
        return BANK[problem_id]


@pytest.fixture(autouse=True)
def fresh_db():
    Base.metadata.drop_all(engine())
    Base.metadata.create_all(engine())
    with Session(engine()) as db:
        db.add(Domain(id=TECH_DOMAIN, tenant_id=None, name="Dev / Data / Technique"))
        db.add(Skill(tenant_id=None, domain_id=TECH_DOMAIN, key="python", name="Python"))
        db.commit()
    yield


@pytest.fixture
def people():
    fake = FakeDirectory()
    app.dependency_overrides[directory] = lambda: fake
    app.dependency_overrides[codeplay] = lambda: FakeBank()
    yield fake
    app.dependency_overrides.clear()


@pytest.fixture
def client(people):
    return TestClient(app)
