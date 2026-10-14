import os
import tempfile

_tmp = tempfile.mkdtemp()
os.environ["DATABASE_URL"] = f"sqlite:///{_tmp}/notifications.db"

import pytest  # noqa: E402

from rh_common.db import Base, engine  # noqa: E402


@pytest.fixture(autouse=True)
def fresh_db():
    import app.models  # noqa: F401

    Base.metadata.drop_all(engine())
    Base.metadata.create_all(engine())
    yield
