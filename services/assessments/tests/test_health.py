from fastapi.testclient import TestClient

from app.main import app


def test_health(monkeypatch, tmp_path):
    from rh_common import db

    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path}/t.db")
    db.engine.cache_clear()
    r = TestClient(app).get("/health")
    db.engine.cache_clear()
    assert r.status_code == 200
    assert r.json()["service"] == "assessments"
