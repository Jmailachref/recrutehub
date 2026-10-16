import os
import tempfile
import time
import uuid

_tmp = tempfile.mkdtemp()
os.environ["DATABASE_URL"] = f"sqlite:///{_tmp}/assessments.db"

import jwt  # noqa: E402
import pytest  # noqa: E402
from cryptography.hazmat.primitives.asymmetric import rsa  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402
from rh_common import ApiError, internal, queue, tokens  # noqa: E402
from rh_common.codeplay import codeplay  # noqa: E402
from rh_common.db import Base, engine  # noqa: E402
from rh_common.library import library  # noqa: E402

KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
tokens.use_local_key(KEY.public_key())

ACME = uuid.uuid4()
GLOBEX = uuid.uuid4()


def sign(claims: dict) -> dict:
    claims = {"iss": tokens.ISSUER, "exp": int(time.time()) + 600, **claims}
    return {"Authorization": f"Bearer {jwt.encode(claims, KEY, algorithm='RS256')}"}


def token(role="recruiter", tenant=ACME) -> dict:
    claims = {"sub": str(uuid.uuid4()), "role": role}
    if tenant is not None:
        claims["tenant_id"] = str(tenant)
    return sign(claims)


QUESTIONS = [
    {"id": str(uuid.uuid4()), "kind": "code", "language": "python", "level": 2, "title": "Sum", "timer_seconds": 600,
     "statement": "Add", "starter_code": "# go", "choices": None, "multiple": False,
     "scenarios": [{"name": "Example", "input": "1 2\n", "expected_output": "3\n", "hidden": False, "order": 0, "weight": 1, "id": str(uuid.uuid4())}],
     "hidden_scenarios": 2},
    {"id": str(uuid.uuid4()), "kind": "code", "language": "python", "level": 2, "title": "Max", "timer_seconds": 600,
     "statement": "Max", "starter_code": None, "choices": None, "multiple": False, "scenarios": [], "hidden_scenarios": 3},
    {"id": str(uuid.uuid4()), "kind": "qcm", "language": "docker", "level": 2, "title": "Ports", "timer_seconds": 60,
     "statement": "Which?", "starter_code": None, "choices": ["a", "b", "c", "d"], "multiple": True, "scenarios": [],
     "hidden_scenarios": 0},
    {"id": str(uuid.uuid4()), "kind": "qcm", "language": "docker", "level": 2, "title": "Layers", "timer_seconds": 60,
     "statement": "Which?", "starter_code": None, "choices": ["a", "b"], "multiple": False, "scenarios": [],
     "hidden_scenarios": 0},
]
CORRECT = {QUESTIONS[2]["id"]: [0, 2], QUESTIONS[3]["id"]: [1]}


class FakeBank:
    def __init__(self):
        self.tests = {}
        self.submissions = {}
        self.runs = []
        self.short = False

    def create_test(self, recipe, scope, external_ref):
        if self.short:
            raise ApiError(409, "not_enough_questions", "short")
        tid = str(uuid.uuid4())
        self.tests[tid] = {"id": tid, "recipe": recipe, "scope": scope, "external_ref": external_ref, "questions": QUESTIONS}
        return self.tests[tid]

    def test(self, test_id):
        return self.tests[test_id]

    def problem_full(self, problem_id):
        q = next(q for q in QUESTIONS if q["id"] == problem_id)
        return {**q, "correct_choices": CORRECT.get(problem_id)}

    def create_run(self, language, source_code, stdin, user_id):
        self.runs.append((language, source_code, stdin, user_id))
        return {"id": str(uuid.uuid4()), "status": "queued"}

    def run(self, run_id):
        return {"id": run_id, "status": "completed", "verdict": "accepted", "stdout": "3\n", "stderr": "", "user_id": "x"}

    def create_submission(self, problem_id, language, source_code, user_id):
        sid = str(uuid.uuid4())
        # "pass" in the code passes 3 of 3 test cases, anything else 1 of 3.
        score = 3 if "pass" in source_code else 1
        self.submissions[sid] = {"status": "queued", "verdict": None, "score": score, "max_score": 3, "user_id": user_id}
        return {"id": sid, "status": "queued"}

    def submission(self, submission_id):
        s = self.submissions[submission_id]
        if s["status"] == "queued":
            s["status"] = "running"
            return dict(s)
        s["status"], s["verdict"] = "completed", "accepted" if s["score"] == 3 else "wrong_answer"
        return dict(s)


OWN = [
    {"id": str(uuid.uuid4()), "language": "finance-de-marche", "skill": "Finance de marché", "level": 3, "kind": "numeric",
     "title": "Simple interest", "statement": "1000 at 5% for 2 years?", "choices": None, "correct_choices": None,
     "multiple": False, "answer_value": 100.0, "tolerance": 0.5, "unit": "EUR", "explanation": "1000 x 5% x 2",
     "timer_seconds": 120},
    {"id": str(uuid.uuid4()), "language": "finance-de-marche", "skill": "Finance de marché", "level": 3, "kind": "qcm",
     "title": "Duration", "statement": "Duration measures?", "choices": ["maturity", "rate sensitivity"],
     "correct_choices": [1], "multiple": False, "answer_value": None, "tolerance": None, "unit": None, "explanation": "",
     "timer_seconds": 60},
]


class FakeLibrary:
    """The company's own questions."""

    def __init__(self):
        self.draws = []

    def draw(self, tenant_id, rows):
        self.draws.append((str(tenant_id), rows))
        return OWN[: sum(r["count"] for r in rows)]

    def questions(self, ids):
        return {q["id"]: q for q in OWN if q["id"] in {str(i) for i in ids}}


class World:
    """Stands in for the other services, the queues and rate limits."""

    def __init__(self):
        self.offer = {
            "id": str(uuid.uuid4()), "tenant_id": str(ACME), "title": "Backend developer", "status": "active",
            "weight_theory": 0.25, "weight_practice": 0.75,
            "recipe": [{"language": "python", "level": 2, "code_count": 2, "qcm_count": 0},
                       {"language": "docker", "level": 2, "code_count": 0, "qcm_count": 2},
                       {"language": "go", "level": 1, "code_count": 0, "qcm_count": 0}],
        }
        self.candidates = {}
        self.jobs = []
        self.calls = []
        self.limited = False

    def add_candidate(self, tenant=ACME):
        cid = str(uuid.uuid4())
        self.candidates[cid] = {"id": cid, "tenant_id": str(tenant), "offer_id": self.offer["id"], "name": "Amina",
                                "email": "amina@example.com", "status": "applied"}
        return cid

    def call(self, method, service, path, **kwargs):
        self.calls.append((method, service, path, kwargs.get("json")))
        if service == "candidates" and method == "GET":
            c = self.candidates.get(path.rsplit("/", 1)[-1])
            if c is None:
                raise ApiError(404, "not_found", "Candidate not found")
            return c
        if service == "candidates":
            cid = path.split("/")[3]
            self.candidates[cid]["status"] = kwargs["json"]["status"]
            return self.candidates[cid]
        if service == "offers":
            return self.offer
        if service == "auth":
            body = kwargs["json"]
            return {"token": f"T:{body['session_id']}", "expires_in": 604800}
        raise AssertionError(path)


@pytest.fixture(autouse=True)
def fresh_db():
    Base.metadata.drop_all(engine())
    Base.metadata.create_all(engine())
    yield


@pytest.fixture
def world(monkeypatch):
    w = World()
    monkeypatch.setattr(internal, "call", w.call)
    monkeypatch.setattr(queue, "enqueue", lambda q, t, **p: w.jobs.append((q, t, p)))
    monkeypatch.setattr(queue, "over_limit", lambda key, limit, window: w.limited)
    return w


@pytest.fixture
def bank():
    fake = FakeBank()
    app.dependency_overrides[codeplay] = lambda: fake
    yield fake
    app.dependency_overrides.clear()


@pytest.fixture
def lib():
    fake = FakeLibrary()
    app.dependency_overrides[library] = lambda: fake
    yield fake
    app.dependency_overrides.pop(library, None)


@pytest.fixture
def client(world, bank, lib):
    return TestClient(app)


def candidate_headers(session: dict) -> dict:
    return sign({"sub": str(session["candidate_id"]), "role": "candidate", "tenant_id": str(ACME),
                 "session_id": str(session["id"])})
