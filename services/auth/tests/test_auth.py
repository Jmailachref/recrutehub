import jwt
from fastapi.testclient import TestClient

from app.main import app
from rh_common import tokens
from tests.conftest import login


def test_health(client):
    assert client.get("/health").json()["database"] is True


def test_login_sets_cookies_and_returns_tokens(client):
    body = login(client)
    assert body["token_type"] == "bearer"
    assert client.cookies.get("rh_access") == body["access_token"]
    assert client.cookies.get("rh_refresh") == body["refresh_token"]
    claims = jwt.decode(body["access_token"], options={"verify_signature": False})
    assert claims["role"] == "admin" and claims["email"] == "admin@acme.com"


def test_access_token_checks_against_jwks(client):
    token = login(client)["access_token"]
    jwk = client.get("/jwks").json()["keys"][0]
    key = jwt.PyJWK(jwk).key
    principal = tokens.decode(token, key)
    assert principal.role == "admin"
    assert jwt.get_unverified_header(token)["kid"] == jwk["kid"]


def test_wrong_password_and_unknown_email_look_the_same(client):
    a = client.post("/login", json={"email": "admin@acme.com", "password": "nope-nope"})
    b = client.post("/login", json={"email": "ghost@acme.com", "password": "nope-nope"})
    assert a.status_code == b.status_code == 401
    assert a.json() == b.json()


def test_too_many_failures_block_login(client):
    for _ in range(10):
        client.post("/login", json={"email": "admin@acme.com", "password": "wrong-wrong"})
    r = client.post("/login", json={"email": "admin@acme.com", "password": "admin-password"})
    assert r.status_code == 429


def test_me_with_cookie_and_with_header(client):
    token = login(client)["access_token"]
    assert client.get("/me").json()["tenant_name"] == "Acme"
    fresh = TestClient(app)
    assert fresh.get("/me").status_code == 401
    assert fresh.get("/me", headers={"Authorization": f"Bearer {token}"}).json()["email"] == "admin@acme.com"


def test_refresh_rotates_and_reuse_signs_out_everywhere(client):
    first = login(client)["refresh_token"]
    second = client.post("/refresh", json={"refresh_token": first})
    assert second.status_code == 200
    # Using the first token again revokes every token of the user, the new one included.
    assert client.post("/refresh", json={"refresh_token": first}).status_code == 401
    assert client.post("/refresh", json={"refresh_token": second.json()["refresh_token"]}).status_code == 401


def test_refresh_from_cookie(client):
    login(client)
    assert client.post("/refresh").status_code == 200


def test_logout_revokes_and_clears_cookies(client):
    refresh = login(client)["refresh_token"]
    assert client.post("/logout").status_code == 204
    assert "rh_access" not in client.cookies
    assert client.post("/refresh", json={"refresh_token": refresh}).status_code == 401


def test_admin_manages_own_tenant_users_only(client):
    login(client)
    r = client.post("/users", json={"email": "Rita@Acme.com", "password": "recruiter-pw", "role": "recruiter"})
    assert r.status_code == 201
    rita = r.json()
    assert rita["email"] == "rita@acme.com"
    assert client.post("/users", json={"email": "rita@acme.com", "password": "another-pw"}).status_code == 409
    assert [u["email"] for u in client.get("/users").json()] == ["admin@acme.com", "rita@acme.com"]

    other = TestClient(app)
    login(other, "admin@globex.com", "globex-password")
    assert [u["email"] for u in other.get("/users").json()] == ["admin@globex.com"]
    assert other.patch(f"/users/{rita['id']}", json={"role": "admin"}).status_code == 404


def test_recruiter_cannot_manage_users(client):
    login(client)
    client.post("/users", json={"email": "rita@acme.com", "password": "recruiter-pw"})
    rita = TestClient(app)
    login(rita, "rita@acme.com", "recruiter-pw")
    assert rita.get("/me").json()["role"] == "recruiter"
    assert rita.get("/users").status_code == 403


def test_disabled_user_cannot_sign_in_or_refresh(client):
    login(client)
    rita_id = client.post("/users", json={"email": "rita@acme.com", "password": "recruiter-pw"}).json()["id"]
    rita = TestClient(app)
    refresh = login(rita, "rita@acme.com", "recruiter-pw")["refresh_token"]
    assert client.patch(f"/users/{rita_id}", json={"is_active": False}).status_code == 200
    assert rita.post("/refresh", json={"refresh_token": refresh}).status_code == 401
    assert rita.post("/login", json={"email": "rita@acme.com", "password": "recruiter-pw"}).status_code == 401


def test_admin_cannot_demote_self(client):
    me = login(client) and client.get("/me").json()
    assert client.patch(f"/users/{me['id']}", json={"role": "recruiter"}).status_code == 400


def test_candidate_token_needs_a_service_token(client):
    body = {
        "tenant_id": "00000000-0000-0000-0000-000000000001",
        "session_id": "00000000-0000-0000-0000-000000000002",
        "candidate_id": "00000000-0000-0000-0000-000000000003",
    }
    login(client)
    assert client.post("/internal/candidate-token", json=body).status_code == 403
    bad = client.post("/internal/service-token", headers={"X-Service-Name": "x", "X-Service-Secret": "nope"})
    assert bad.status_code == 401
    service = client.post(
        "/internal/service-token", headers={"X-Service-Name": "assessments", "X-Service-Secret": "test-secret"}
    ).json()["token"]
    anon = TestClient(app)
    r = anon.post("/internal/candidate-token", json=body, headers={"Authorization": f"Bearer {service}"})
    assert r.status_code == 200
    claims = jwt.decode(r.json()["token"], options={"verify_signature": False})
    assert claims["role"] == "candidate" and claims["session_id"].endswith("2")
    assert claims["exp"] - claims["iat"] == 7 * 24 * 3600


def test_services_read_user_names(client):
    login(client)
    rita = client.post("/users", json={"email": "rita@acme.com", "password": "recruiter-pw", "full_name": "Rita Moreau"}).json()
    me = client.get("/me").json()
    body = {"ids": [rita["id"], me["id"], "00000000-0000-0000-0000-000000000009"]}
    assert client.post("/internal/users/names", json=body).status_code == 403
    service = client.post(
        "/internal/service-token", headers={"X-Service-Name": "candidates", "X-Service-Secret": "test-secret"}
    ).json()["token"]
    r = TestClient(app).post("/internal/users/names", json=body, headers={"Authorization": f"Bearer {service}"})
    assert r.json() == {rita["id"]: "Rita Moreau", me["id"]: me["full_name"] or me["email"]}
