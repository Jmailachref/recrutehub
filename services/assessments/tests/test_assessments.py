from datetime import timedelta

from conftest import ACME, CORRECT, GLOBEX, QUESTIONS, candidate_headers, token

from app import scoring
from app.models import TestSession
from rh_common.db import _sessions


def invite(client, world):
    cid = world.add_candidate()
    r = client.post("/sessions", json={"candidate_id": cid}, headers=token())
    assert r.status_code == 201, r.text
    return r.json()


def score(world, bank):
    jobs = [p for q, t, p in world.jobs if t == "score_session"]
    with _sessions()() as db:
        for job in jobs:
            scoring.score_session(job, db, bank, sleep=lambda s: None)


def test_health(client):
    assert client.get("/health").json()["service"] == "assessments"


def test_invite_draws_questions_and_emails_the_link(client, world, bank):
    s = invite(client, world)
    assert s["status"] == "invited"
    (test,) = bank.tests.values()
    assert test["recipe"] == [
        {"language": "python", "level": 2, "code": 2, "qcm": 0},
        {"language": "docker", "level": 2, "code": 0, "qcm": 2},
    ]
    assert (test["scope"], test["external_ref"]) == (str(ACME), s["id"])
    ((q, t, email),) = [j for j in world.jobs if j[0] == "notifications"]
    assert (t, email["template"], email["to"]) == ("send_email", "test_invite", "amina@example.com")
    assert email["data"]["link"] == f"http://localhost/test#T:{s['id']}"
    assert world.candidates[s["candidate_id"]]["status"] == "invited"


def test_invite_once_and_only_for_open_offers(client, world, bank):
    s = invite(client, world)
    r = client.post("/sessions", json={"candidate_id": s["candidate_id"]}, headers=token())
    assert (r.status_code, r.json()["error"]["code"]) == (409, "already_invited")
    world.offer["status"] = "archived"
    r = client.post("/sessions", json={"candidate_id": world.add_candidate()}, headers=token())
    assert r.json()["error"]["code"] == "offer_closed"
    world.offer["status"] = "active"
    bank.short = True
    r = client.post("/sessions", json={"candidate_id": world.add_candidate()}, headers=token())
    assert r.json()["error"]["code"] == "not_enough_questions"


def test_invite_only_own_candidates_and_writers(client, world):
    other = world.add_candidate(tenant=GLOBEX)
    assert client.post("/sessions", json={"candidate_id": other}, headers=token()).status_code == 404
    mine = world.add_candidate()
    assert client.post("/sessions", json={"candidate_id": mine}, headers=token(role="editor")).status_code == 403


def test_candidate_takes_the_test(client, world, bank):
    s = invite(client, world)
    me = candidate_headers(s)
    before = client.get("/me", headers=me).json()
    assert (before["status"], before["questions"], before["question_count"], before["code_count"]) == ("invited", [], 4, 2)
    assert before["duration_seconds"] == 1320

    started = client.post("/me/start", headers=me).json()
    assert started["status"] == "in_progress" and 1300 < started["seconds_left"] <= 1320
    q = started["questions"]
    assert [x["kind"] for x in q] == ["code", "code", "qcm", "qcm"]
    assert q[0]["examples"] == [{"name": "Example", "input": "1 2\n", "expected_output": "3\n"}]
    assert "correct_choices" not in q[2] and q[0]["hidden_tests"] == 2

    code1, code2, qcm1, qcm2 = (x["id"] for x in q)
    assert client.put(f"/me/answers/{code1}", json={"source_code": "pass"}, headers=me).status_code == 204
    assert client.put(f"/me/answers/{code2}", json={"source_code": "nope"}, headers=me).status_code == 204
    assert client.put(f"/me/answers/{qcm1}", json={"choices": [2, 0, 2]}, headers=me).status_code == 204
    assert client.put(f"/me/answers/{qcm2}", json={"choices": [0]}, headers=me).status_code == 204
    assert client.put(f"/me/answers/{qcm1}", json={"source_code": "x"}, headers=me).status_code == 400
    again = client.get("/me", headers=me).json()["questions"]
    assert (again[0]["answer_source"], again[2]["answer_choices"]) == ("pass", [0, 2])

    run = client.post("/me/runs", json={"problem_id": code1, "source_code": "print(3)", "stdin": "1 2\n"}, headers=me)
    assert run.status_code == 202 and bank.runs == [("python", "print(3)", "1 2\n", s["id"])]
    out = client.get(f"/me/runs/{run.json()['id']}", headers=me).json()
    assert out["stdout"] == "3\n" and "user_id" not in out
    assert client.post("/me/runs", json={"problem_id": qcm1, "source_code": "x"}, headers=me).status_code == 404

    done = client.post("/me/submit", headers=me).json()
    assert (done["status"], done["questions"]) == ("submitted", [])
    assert client.put(f"/me/answers/{code1}", json={"source_code": "late"}, headers=me).status_code == 409
    assert world.candidates[s["candidate_id"]]["status"] == "tested"
    assert [p["template"] for q_, t, p in world.jobs if t == "send_email"] == ["test_invite", "test_confirmation"]

    score(world, bank)
    detail = client.get(f"/sessions/{s['id']}", headers=token()).json()
    assert detail["status"] == "scored"
    # Code: 3/3 and 1/3 -> 66.7. QCM: right, wrong -> 50. Total: 0.25 * 50 + 0.75 * 66.7.
    assert (detail["practice_score"], detail["theory_score"], detail["total_score"]) == (66.7, 50.0, 62.5)
    a = detail["answers"]
    assert [x["verdict"] for x in a] == ["accepted", "wrong_answer", "correct", "wrong"]
    assert a[2]["correct_choices"] == CORRECT[QUESTIONS[2]["id"]] and a[2]["options"] == ["a", "b", "c", "d"]
    assert a[0]["source_code"] == "pass"


def test_unanswered_questions_score_zero(client, world, bank):
    s = invite(client, world)
    me = candidate_headers(s)
    client.post("/me/start", headers=me)
    client.post("/me/submit", headers=me)
    score(world, bank)
    detail = client.get(f"/sessions/{s['id']}", headers=token()).json()
    assert detail["total_score"] == 0.0
    assert {x["verdict"] for x in detail["answers"]} == {"no_answer"}
    assert bank.submissions == {}


def test_time_runs_out(client, world, bank):
    s = invite(client, world)
    me = candidate_headers(s)
    client.post("/me/start", headers=me)
    with _sessions()() as db:
        row = db.get(TestSession, __import__("uuid").UUID(s["id"]))
        row.started_at = scoring.now() - timedelta(seconds=row.duration_seconds) - scoring.GRACE - timedelta(seconds=1)
        db.commit()
    code1 = QUESTIONS[0]["id"]
    r = client.put(f"/me/answers/{code1}", json={"source_code": "pass"}, headers=me)
    assert (r.status_code, r.json()["error"]["code"]) == (409, "test_not_running")
    assert client.get("/me", headers=me).json()["status"] == "submitted"


def test_link_expires_if_never_started(client, world):
    s = invite(client, world)
    with _sessions()() as db:
        row = db.get(TestSession, __import__("uuid").UUID(s["id"]))
        row.link_expires_at = scoring.now() - timedelta(minutes=1)
        db.commit()
    me = candidate_headers(s)
    assert client.post("/me/start", headers=me).json()["error"]["code"] == "link_expired"
    assert client.get("/sessions", headers=token()).json()[0]["status"] == "expired"


def test_a_token_opens_only_its_own_test(client, world):
    s = invite(client, world)
    other = invite(client, world)
    forged = candidate_headers({"id": other["id"], "candidate_id": s["candidate_id"]})
    assert client.get("/me", headers=forged).status_code == 404
    assert client.get("/me", headers=token()).status_code == 403
    assert client.get("/sessions", headers=candidate_headers(s)).status_code == 403


def test_ranking_and_company_scope(client, world, bank):
    low, high = invite(client, world), invite(client, world)
    for s, code in ((low, "nope"), (high, "pass")):
        me = candidate_headers(s)
        client.post("/me/start", headers=me)
        client.put(f"/me/answers/{QUESTIONS[0]['id']}", json={"source_code": code}, headers=me)
        client.post("/me/submit", headers=me)
    pending = invite(client, world)
    score(world, bank)
    ranked = client.get(f"/sessions?offer_id={world.offer['id']}", headers=token(role="editor")).json()
    assert [r["id"] for r in ranked] == [high["id"], low["id"], pending["id"]]
    assert client.get("/sessions", headers=token(tenant=GLOBEX)).json() == []
    assert client.get(f"/sessions/{high['id']}", headers=token(tenant=GLOBEX)).status_code == 404


def test_rate_limited_runs(client, world):
    s = invite(client, world)
    me = candidate_headers(s)
    client.post("/me/start", headers=me)
    world.limited = True
    r = client.post("/me/runs", json={"problem_id": QUESTIONS[0]["id"], "source_code": "x"}, headers=me)
    assert r.status_code == 429
