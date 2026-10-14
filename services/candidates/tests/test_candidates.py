import uuid

from conftest import ACME, GLOBEX, PDF, apply, token

from app.main import MAX_CV_BYTES


def test_health(client):
    assert client.get("/health").json()["service"] == "candidates"


def test_apply_stores_cv_and_queues_the_email(client, fakes):
    r = apply(client, email=" Amina@Acme.com ", phone="+216 20 000 000")
    assert r.status_code == 201, r.text
    cid = r.json()["id"]
    offer = fakes.offers["open"]
    assert fakes.files == {f"{ACME}/{offer['id']}/{cid}.pdf": PDF}
    assert fakes.jobs == [
        (
            "notifications",
            "send_email",
            {
                "template": "application_received",
                "to": "amina@acme.com",
                "tenant_id": str(ACME),
                "data": {"name": "Amina Haddad", "offer_title": "Backend developer"},
            },
        )
    ]
    listed = client.get("/candidates", headers=token()).json()
    assert [(c["id"], c["email"], c["phone"], c["status"]) for c in listed] == [
        (cid, "amina@acme.com", "+216 20 000 000", "applied")
    ]


def test_apply_only_to_open_offers(client):
    assert apply(client, token="draft").json()["error"]["code"] == "not_found"
    assert apply(client, token="nope").status_code == 404


def test_cv_must_be_a_small_pdf(client, fakes):
    r = apply(client, cv=b"<html>not a pdf</html>")
    assert (r.status_code, r.json()["error"]["code"]) == (422, "not_a_pdf")
    r = apply(client, cv=b"%PDF-" + b"0" * MAX_CV_BYTES)
    assert (r.status_code, r.json()["error"]["code"]) == (413, "file_too_large")
    assert fakes.files == {} and fakes.jobs == []


def test_form_is_validated(client):
    assert apply(client, email="not-an-email").status_code == 400
    assert apply(client, name="").status_code == 400


def test_one_application_per_email_and_offer(client):
    assert apply(client).status_code == 201
    r = apply(client, email="AMINA@acme.com")
    assert (r.status_code, r.json()["error"]["code"]) == (409, "already_applied")
    assert apply(client, token="globex").status_code == 201


def test_rate_limited_per_visitor(client, fakes):
    fakes.limit_hit = True
    r = apply(client)
    assert (r.status_code, r.json()["error"]["code"]) == (429, "rate_limited")


def test_recruiters_see_only_their_company(client, fakes):
    mine = apply(client).json()["id"]
    theirs = apply(client, token="globex", email="sam@globex.com").json()["id"]
    assert [c["id"] for c in client.get("/candidates", headers=token()).json()] == [mine]
    assert client.get(f"/candidates/{theirs}", headers=token()).status_code == 404
    assert client.get(f"/candidates/{mine}", headers=token(tenant=GLOBEX)).status_code == 404
    offer_id = fakes.offers["open"]["id"]
    assert len(client.get(f"/candidates?offer_id={offer_id}", headers=token()).json()) == 1
    assert client.get(f"/candidates?offer_id={fakes.offers['draft']['id']}", headers=token()).json() == []


def test_cv_download(client):
    cid = apply(client).json()["id"]
    r = client.get(f"/candidates/{cid}/cv", headers=token(role="editor"))
    assert r.status_code == 200
    assert r.content == PDF
    assert r.headers["content-type"] == "application/pdf"
    assert 'filename="Amina Haddad.pdf"' in r.headers["content-disposition"]


def test_staff_only(client):
    assert client.get("/candidates").status_code == 401
    assert client.get("/candidates", headers=token(role="candidate")).status_code == 403


def test_internal_read_and_status(client):
    cid = apply(client).json()["id"]
    service = token(role="service", tenant=None)
    c = client.get(f"/internal/candidates/{cid}", headers=service).json()
    assert (c["tenant_id"], c["status"]) == (str(ACME), "applied")
    r = client.post(f"/internal/candidates/{cid}/status", json={"status": "invited"}, headers=service)
    assert r.json()["status"] == "invited"
    assert client.get(f"/candidates/{cid}", headers=token()).json()["status"] == "invited"
    assert client.get(f"/internal/candidates/{cid}", headers=token()).status_code == 403
    offer_id = c["offer_id"]
    assert client.get(f"/internal/offers/{offer_id}/count", headers=service).json() == {"count": 1}
    assert client.get(f"/internal/offers/{uuid.uuid4()}/count", headers=service).json() == {"count": 0}
