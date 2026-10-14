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
from rh_common import tokens  # noqa: E402
from rh_common.codeplay import codeplay  # noqa: E402
from rh_common.db import Base, engine  # noqa: E402

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
def client(bank):
    return TestClient(app)
