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


class FakeBank:
    def stock(self, language=None):
        return [{"language": "python", "level": 3, "code": 2, "qcm": 2}, {"language": "rust", "level": 1, "code": 1, "qcm": 0}]


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
