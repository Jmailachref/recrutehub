import uuid

from tests.conftest import GLOBEX, token

QCM = {
    "level": 2,
    "kind": "qcm",
    "title": "Duration of a bond",
    "statement": "What does a bond's duration measure?",
    "choices": ["Its maturity", "Its price sensitivity to rates", "Its coupon"],
    "correct_choices": [1],
}
NUMERIC = {
    "level": 1,
    "kind": "numeric",
    "title": "Simple interest",
    "statement": "1000 EUR at 5% a year for 2 years, simple interest: how much interest?",
    "answer_value": 100,
    "tolerance": 0.5,
    "unit": "EUR",
}


def finance(client, admin):
    d = client.post("/domains", json={"name": "Finance"}, headers=admin)
    assert d.status_code == 201
    s = client.post("/skills", json={"domain_id": d.json()["id"], "name": "Finance de marché"}, headers=admin)
    assert s.status_code == 201
    return d.json(), s.json()


def test_catalog_has_the_tech_domain_and_codeplay_topics(client, people):
    me = token(people.add("Rita"))
    domains = client.get("/catalog", headers=me).json()
    assert [d["name"] for d in domains] == ["Dev / Data / Technique"]
    assert {s["key"] for s in domains[0]["skills"]} == {"python", "rust"}
    assert all(s["builtin"] for s in domains[0]["skills"])


def test_companies_create_their_own_domains_and_skills(client, people):
    admin = token(people.add("Ada", "admin", 4), "admin")
    domain, skill = finance(client, admin)
    assert skill["key"] == "finance-de-marche" and skill["own"]
    assert client.post("/domains", json={"name": "finance"}, headers=admin).status_code == 409
    assert client.post("/skills", json={"domain_id": domain["id"], "name": "Python"}, headers=admin).status_code == 409
    # Recruiters write questions but do not shape the catalog.
    rita = token(people.add("Rita"))
    assert client.post("/domains", json={"name": "Compta"}, headers=rita).status_code == 403
    # Another company does not see them.
    other = token(people.add("Gus", "admin", tenant=GLOBEX), "admin", GLOBEX)
    assert [d["name"] for d in client.get("/catalog", headers=other).json()] == ["Dev / Data / Technique"]
    assert client.post("/skills", json={"domain_id": domain["id"], "name": "X"}, headers=other).status_code == 404
    # Built-in ones cannot change; a non-empty domain cannot go.
    tech = client.get("/catalog", headers=admin).json()[0]
    assert client.patch(f"/domains/{tech['id']}", json={"name": "Tech"}, headers=admin).status_code == 403
    assert client.delete(f"/domains/{domain['id']}", headers=admin).status_code == 409


def test_question_goes_from_draft_to_review_to_tests(client, people):
    admin = token(people.add("Ada", "admin", 4), "admin")
    _, skill = finance(client, admin)
    junior_id, senior_id, peer_id = people.add("June", experience=1), people.add("Sam", experience=3), people.add("Pat", experience=1)
    junior, senior, peer = token(junior_id), token(senior_id), token(peer_id)

    q = client.post("/questions", json={**QCM, "skill_id": skill["id"]}, headers=junior).json()
    assert q["status"] == "draft" and q["can_edit"]
    # Drafts are their author's only.
    assert client.get(f"/questions/{q['id']}", headers=senior).status_code == 404
    assert client.post(f"/questions/{q['id']}/submit", headers=junior).json()["status"] == "pending"

    # Someone as experienced as the author cannot validate; someone more experienced can.
    assert client.get("/reviews", headers=peer).json() == []
    assert client.post(f"/questions/{q['id']}/review", json={"decision": "approve"}, headers=peer).status_code == 403
    assert [r["id"] for r in client.get("/reviews", headers=senior).json()] == [q["id"]]
    assert client.post(f"/questions/{q['id']}/review", json={"decision": "reject"}, headers=senior).status_code == 400
    r = client.post(f"/questions/{q['id']}/review", json={"decision": "reject", "comment": "Say modified duration"}, headers=senior)
    assert r.json()["status"] == "rejected" and r.json()["reviewer"]["name"] == "Sam"

    fixed = client.put(f"/questions/{q['id']}", json={**QCM, "skill_id": skill["id"], "title": "Modified duration", "submit": True}, headers=junior)
    assert fixed.json()["status"] == "pending"
    assert client.post(f"/questions/{q['id']}/review", json={"decision": "approve"}, headers=senior).json()["status"] == "approved"
    assert client.put(f"/questions/{q['id']}", json={**QCM, "skill_id": skill["id"]}, headers=junior).status_code == 409

    lib = next(s for d in client.get("/catalog", headers=junior).json() for s in d["skills"] if s["id"] == skill["id"])
    assert lib["library"] == [{"level": 2, "approved": 1, "pending": 0}]


def test_admin_validates_anyone_but_not_themselves(client, people):
    admin_id = people.add("Ada", "admin", 1)
    admin = token(admin_id, "admin")
    expert = token(people.add("Eve", experience=4))
    _, skill = finance(client, admin)
    q = client.post("/questions", json={**NUMERIC, "skill_id": skill["id"], "submit": True}, headers=expert).json()
    assert client.post(f"/questions/{q['id']}/review", json={"decision": "approve"}, headers=admin).json()["status"] == "approved"
    mine = client.post("/questions", json={**NUMERIC, "skill_id": skill["id"], "submit": True}, headers=admin).json()
    assert mine["can_review"] is False
    assert client.post(f"/questions/{mine['id']}/review", json={"decision": "approve"}, headers=admin).status_code == 403


def test_a_correction_replaces_the_approved_question_once_validated(client, people):
    admin = token(people.add("Ada", "admin", 4), "admin")
    _, skill = finance(client, admin)
    author = token(people.add("June", experience=1))
    q = client.post("/questions", json={**NUMERIC, "skill_id": skill["id"], "submit": True}, headers=author).json()
    client.post(f"/questions/{q['id']}/review", json={"decision": "approve"}, headers=admin)

    other = token(people.add("Pat", experience=2))
    fix = client.post(f"/questions/{q['id']}/corrections", json={**NUMERIC, "skill_id": skill["id"], "tolerance": 1, "submit": True}, headers=other)
    assert fix.status_code == 201 and fix.json()["replaces_id"] == q["id"]
    # Until validated, the original stays in tests.
    assert client.get(f"/questions/{q['id']}", headers=author).json()["status"] == "approved"
    client.post(f"/questions/{fix.json()['id']}/review", json={"decision": "approve"}, headers=admin)
    assert client.get(f"/questions/{q['id']}", headers=author).json()["status"] == "retired"


def test_answers_must_fit_the_kind(client, people):
    admin = token(people.add("Ada", "admin", 4), "admin")
    _, skill = finance(client, admin)
    bad_qcm = {**QCM, "skill_id": skill["id"], "correct_choices": [5]}
    assert client.post("/questions", json=bad_qcm, headers=admin).status_code == 400
    no_value = {**NUMERIC, "skill_id": skill["id"], "answer_value": None}
    assert client.post("/questions", json=no_value, headers=admin).status_code == 400


def test_services_read_stock_and_draw_questions(client, people):

    admin_id = people.add("Ada", "admin", 4)
    admin = token(admin_id, "admin")
    _, skill = finance(client, admin)
    author = token(people.add("June"))
    ids = []
    for i in range(3):
        q = client.post("/questions", json={**NUMERIC, "title": f"Q{i}", "skill_id": skill["id"], "submit": True}, headers=author).json()
        client.post(f"/questions/{q['id']}/review", json={"decision": "approve"}, headers=admin)
        ids.append(q["id"])
    service = token(uuid.uuid4(), "service", None)
    assert client.get("/internal/stock", params={"tenant_id": str(uuid.UUID(int=0))}, headers=admin).status_code == 403
    from tests.conftest import ACME

    stock = client.get("/internal/stock", params={"tenant_id": str(ACME)}, headers=service).json()
    assert stock == [{"language": "finance-de-marche", "level": 1, "count": 3}]
    body = {"tenant_id": str(ACME), "rows": [{"language": "finance-de-marche", "level": 1, "count": 2}]}
    drawn = client.post("/internal/draw", json=body, headers=service).json()
    assert len(drawn) == 2 and drawn[0]["answer_value"] == 100 and drawn[0]["kind"] == "numeric"
    # The one not drawn yet comes first next time.
    again = client.post("/internal/draw", json={**body, "rows": [{"language": "finance-de-marche", "level": 1, "count": 1}]}, headers=service).json()
    assert again[0]["id"] not in {d["id"] for d in drawn}
    body["rows"][0]["count"] = 4
    assert client.post("/internal/draw", json=body, headers=service).status_code == 409
    assert client.get(f"/internal/questions/{ids[0]}", headers=service).json()["tolerance"] == 0.5
    batch = client.post("/internal/questions", json={"ids": ids[:2]}, headers=service).json()
    assert {q["id"] for q in batch} == set(ids[:2])
