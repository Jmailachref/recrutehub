from tests.conftest import GLOBEX, token

RECRUITER = token()
RECIPE = {
    "rows": [
        {"language": "python", "level": 5, "code_count": 4, "qcm_count": 1},
        {"language": "sql", "level": 3, "code_count": 4},
        {"language": "docker", "level": 2, "qcm_count": 6},
    ]
}


def new_offer(client, **overrides):
    r = client.post("/offers", json={"title": "Backend developer", **overrides}, headers=RECRUITER)
    assert r.status_code == 201, r.text
    return r.json()


def test_health(client):
    assert client.get("/health").json()["database"] is True


def test_create_and_list_offers_per_company(client):
    offer = new_offer(client, description="Python and SQL")
    assert offer["status"] == "draft" and offer["question_budget"] == 20 and offer["public_token"]
    assert [o["title"] for o in client.get("/offers", headers=RECRUITER).json()] == ["Backend developer"]
    other = token(tenant=GLOBEX)
    assert client.get("/offers", headers=other).json() == []
    assert client.get(f"/offers/{offer['id']}", headers=other).status_code == 404
    assert client.get("/offers").status_code == 401


def test_editor_reads_but_cannot_write(client):
    offer = new_offer(client)
    editor = token("editor")
    assert client.get(f"/offers/{offer['id']}", headers=editor).status_code == 200
    assert client.patch(f"/offers/{offer['id']}", json={"title": "x"}, headers=editor).status_code == 403


def test_recipe_from_the_example(client):
    offer = new_offer(client, question_budget=19)
    r = client.put(f"/offers/{offer['id']}/recipe", json=RECIPE, headers=RECRUITER)
    assert r.status_code == 200, r.text
    recipe = r.json()
    assert recipe["total"] == 15 and recipe["budget"] == 19
    assert [w["code"] for w in recipe["warnings"]] == ["budget_mismatch"]
    python = recipe["rows"][0]
    assert (python["stock_code"], python["stock_qcm"], python["available_levels"]) == (6, 3, [1, 5])
    assert client.get(f"/offers/{offer['id']}", headers=RECRUITER).json()["question_count"] == 15


def test_recipe_cannot_exceed_stock(client):
    offer = new_offer(client)
    too_many = {"rows": [{"language": "sql", "level": 3, "qcm_count": 1}]}
    r = client.put(f"/offers/{offer['id']}/recipe", json=too_many, headers=RECRUITER)
    assert r.status_code == 409 and r.json()["error"]["code"] == "not_enough_questions"
    dup = {"rows": [{"language": "sql", "level": 3}, {"language": "sql", "level": 3}]}
    assert client.put(f"/offers/{offer['id']}/recipe", json=dup, headers=RECRUITER).status_code == 400


def test_stock_drop_shows_a_warning_and_blocks_publishing(client, bank):
    offer = new_offer(client)
    client.put(f"/offers/{offer['id']}/recipe", json=RECIPE, headers=RECRUITER)
    bank.rows[3]["qcm"] = 2
    recipe = client.get(f"/offers/{offer['id']}/recipe", headers=RECRUITER).json()
    assert {"code": "stock_low", "row": 2} == {k: recipe["warnings"][0][k] for k in ("code", "row")}
    r = client.post(f"/offers/{offer['id']}/publish", headers=RECRUITER)
    assert r.status_code == 409 and r.json()["error"]["code"] == "recipe_not_ready"


def test_publish_opens_the_public_page_and_archive_closes_it(client):
    offer = new_offer(client, description="We build things")
    token_ = offer["public_token"]
    assert client.get(f"/public/{token_}").status_code == 404
    assert client.post(f"/offers/{offer['id']}/publish", headers=RECRUITER).status_code == 409  # empty
    client.put(f"/offers/{offer['id']}/recipe", json=RECIPE, headers=RECRUITER)
    assert client.post(f"/offers/{offer['id']}/publish", headers=RECRUITER).json()["status"] == "active"
    assert client.get(f"/public/{token_}").json() == {"title": "Backend developer", "description": "We build things"}
    client.post(f"/offers/{offer['id']}/archive", headers=RECRUITER)
    assert client.get(f"/public/{token_}").status_code == 404
    assert client.post(f"/offers/{offer['id']}/restore", headers=RECRUITER).json()["status"] == "draft"


def test_weights_add_up_to_one(client):
    offer = new_offer(client)
    ok = client.patch(f"/offers/{offer['id']}/weights", json={"weight_theory": 0.3, "weight_practice": 0.7}, headers=RECRUITER)
    assert ok.json()["weight_practice"] == 0.7
    bad = client.patch(f"/offers/{offer['id']}/weights", json={"weight_theory": 0.3, "weight_practice": 0.3}, headers=RECRUITER)
    assert bad.status_code == 400


def test_internal_endpoints_need_a_service_token(client):
    offer = new_offer(client)
    client.put(f"/offers/{offer['id']}/recipe", json=RECIPE, headers=RECRUITER)
    assert client.get(f"/internal/offers/{offer['id']}", headers=RECRUITER).status_code == 403
    service = token("service", tenant=None, sub="assessments")
    full = client.get(f"/internal/offers/{offer['id']}", headers=service).json()
    assert len(full["recipe"]) == 3 and full["tenant_id"]
    by_token = client.get(f"/internal/offers/by-token/{offer['public_token']}", headers=service).json()
    assert by_token["id"] == offer["id"]


def test_stock_for_the_editor(client):
    assert len(client.get("/stock", headers=RECRUITER).json()) == 4


SKILLS = [
    {"language": "python", "priority": 1},
    {"language": "docker", "priority": 2},
    {"language": "sql", "priority": 3},
    {"language": "rust", "priority": 2},
    {"language": "go", "priority": 4},
]


def test_skills_are_kept_and_appear_once(client):
    offer = new_offer(client, skills=SKILLS)
    assert offer["skills"] == SKILLS
    dup = [{"language": "sql", "priority": 1}, {"language": "sql", "priority": 2}]
    assert client.post("/offers", json={"title": "x", "skills": dup}, headers=RECRUITER).status_code == 400
    r = client.patch(f"/offers/{offer['id']}", json={"skills": SKILLS[:1]}, headers=RECRUITER)
    assert r.json()["skills"] == SKILLS[:1]


def test_generate_recipe_from_priorities(client):
    offer = new_offer(client, skills=SKILLS, question_budget=16)
    r = client.post(f"/offers/{offer['id']}/recipe/generate", headers=RECRUITER)
    assert r.status_code == 200, r.text
    recipe = r.json()
    rows = {row["language"]: row for row in recipe["rows"]}
    # rust has no questions and go is CV only; python (core) has no level 3, so level 5.
    assert list(rows) == ["python", "docker", "sql"]
    assert (rows["python"]["level"], rows["docker"]["level"], rows["sql"]["level"]) == (5, 2, 3)
    assert rows["docker"]["code_count"] == 0 and rows["sql"]["qcm_count"] == 0
    assert recipe["total"] == 16
    assert {(w["code"], w["skill"]) for w in recipe["warnings"]} >= {("no_stock", "rust"), ("level_adjusted", "python")}
    assert all(w["code"] != "budget_mismatch" for w in recipe["warnings"])


def test_generate_stops_at_stock(client):
    offer = new_offer(client, skills=[{"language": "sql", "priority": 1}], question_budget=10)
    recipe = client.post(f"/offers/{offer['id']}/recipe/generate", headers=RECRUITER).json()
    assert recipe["rows"][0]["code_count"] == 4 and recipe["total"] == 4
    assert [w["code"] for w in recipe["warnings"]] == ["stock_reduced", "budget_mismatch"]


def test_delete_only_without_candidates(client, monkeypatch):
    import app.main

    applied = {"count": 2}
    monkeypatch.setattr(app.main.internal, "call", lambda method, service, path: dict(applied))
    offer = new_offer(client)
    r = client.delete(f"/offers/{offer['id']}", headers=RECRUITER)
    assert r.status_code == 409 and r.json()["error"]["code"] == "has_candidates"
    assert client.delete(f"/offers/{offer['id']}", headers=token("editor")).status_code == 403
    applied["count"] = 0
    assert client.delete(f"/offers/{offer['id']}", headers=RECRUITER).status_code == 204
    assert client.get(f"/offers/{offer['id']}", headers=RECRUITER).status_code == 404
