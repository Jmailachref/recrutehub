import os
import tempfile

_tmp = tempfile.mkdtemp()
os.environ["DATABASE_URL"] = f"sqlite:///{_tmp}/auth.db"
os.environ["AUTH_PRIVATE_KEY_FILE"] = f"{_tmp}/keys/private.pem"
os.environ["SERVICE_SECRET"] = "test-secret"
os.environ.pop("REDIS_URL", None)

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app import config  # noqa: E402
from app.bootstrap import bootstrap  # noqa: E402
from app.main import app  # noqa: E402
from app.security import throttle  # noqa: E402
from rh_common.db import Base, engine  # noqa: E402

config.SERVICE_SECRET = "test-secret"


@pytest.fixture(autouse=True)
def fresh_db():
    Base.metadata.drop_all(engine())
    Base.metadata.create_all(engine())
    throttle._memory.clear()
    bootstrap("Acme", "admin@acme.com", "admin-password")
    bootstrap("Globex", "admin@globex.com", "globex-password")
    yield


@pytest.fixture
def client():
    return TestClient(app)


def login(client, email="admin@acme.com", password="admin-password"):
    r = client.post("/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return r.json()
