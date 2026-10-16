import hmac
import uuid
from datetime import UTC, datetime, timedelta
from typing import Annotated, Literal

from fastapi import Depends, Header, Request, Response
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import config, keys
from app.models import RefreshToken, User
from app.security import check_password, hash_password, hash_refresh_token, new_refresh_token, sign, throttle
from rh_common import ApiError, Principal, create_app, require_role
from rh_common.db import get_session
from rh_common.tokens import ACCESS_COOKIE, use_local_key

REFRESH_COOKIE = "rh_refresh"

app = create_app("auth")
use_local_key(keys.private_key().public_key())

Db = Annotated[Session, Depends(get_session)]
Password = Annotated[str, Field(min_length=8, max_length=200)]
Role = Literal["admin", "editor", "recruiter"]
Experience = Annotated[int, Field(ge=1, le=4, description="1 junior, 2 intermediate, 3 senior, 4 expert")]


class LoginIn(BaseModel):
    email: str = Field(max_length=255)
    password: str = Field(max_length=200)


class RefreshIn(BaseModel):
    refresh_token: str | None = None


class TokensOut(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int


class UserOut(BaseModel):
    id: uuid.UUID
    email: str
    full_name: str
    role: str
    experience: int
    is_active: bool
    tenant_id: uuid.UUID
    tenant_name: str


class UserIn(BaseModel):
    email: EmailStr
    full_name: str = Field(default="", max_length=100)
    password: Password
    role: Role = "recruiter"
    experience: Experience = 1


class UserUpdate(BaseModel):
    full_name: str | None = Field(default=None, max_length=100)
    password: Password | None = None
    role: Role | None = None
    experience: Experience | None = None
    is_active: bool | None = None


class CandidateTokenIn(BaseModel):
    tenant_id: uuid.UUID
    session_id: uuid.UUID
    candidate_id: uuid.UUID


class TokenOut(BaseModel):
    token: str
    expires_in: int


def user_out(user: User) -> UserOut:
    return UserOut(
        id=user.id,
        email=user.email,
        full_name=user.full_name,
        role=user.role,
        experience=user.experience,
        is_active=user.is_active,
        tenant_id=user.tenant_id,
        tenant_name=user.tenant.name,
    )


def issue_tokens(db: Session, user: User, response: Response) -> TokensOut:
    access = sign(
        {"sub": str(user.id), "tenant_id": str(user.tenant_id), "role": user.role, "email": user.email},
        config.ACCESS_TTL_SECONDS,
    )
    refresh, refresh_hash = new_refresh_token()
    db.add(
        RefreshToken(
            user_id=user.id,
            token_hash=refresh_hash,
            expires_at=datetime.now(UTC) + timedelta(seconds=config.REFRESH_TTL_SECONDS),
        )
    )
    db.commit()
    cookie = {"httponly": True, "secure": config.COOKIE_SECURE, "samesite": "lax", "path": "/"}
    response.set_cookie(ACCESS_COOKIE, access, max_age=config.ACCESS_TTL_SECONDS, **cookie)
    response.set_cookie(REFRESH_COOKIE, refresh, max_age=config.REFRESH_TTL_SECONDS, **cookie)
    return TokensOut(access_token=access, refresh_token=refresh, expires_in=config.ACCESS_TTL_SECONDS)


def clear_cookies(response: Response) -> None:
    response.delete_cookie(ACCESS_COOKIE, path="/")
    response.delete_cookie(REFRESH_COOKIE, path="/")


@app.post("/login", response_model=TokensOut, tags=["sign in"])
def login(body: LoginIn, response: Response, db: Db) -> TokensOut:
    email = body.email.lower()
    if throttle.blocked(email):
        raise ApiError(429, "too_many_attempts", "Too many failed sign-ins. Try again in 15 minutes.")
    user = db.scalar(select(User).where(User.email == email))
    if not check_password(user.password_hash if user else None, body.password) or not user.is_active:
        throttle.failed(email)
        raise ApiError(401, "invalid_credentials", "Wrong email or password")
    throttle.reset(email)
    return issue_tokens(db, user, response)


@app.post("/refresh", response_model=TokensOut, tags=["sign in"])
def refresh(request: Request, response: Response, db: Db, body: RefreshIn | None = None) -> TokensOut:
    """Swaps a refresh token (body or rh_refresh cookie) for a new pair; each one works once."""
    token = (body.refresh_token if body else None) or request.cookies.get(REFRESH_COOKIE)
    if not token:
        raise ApiError(401, "unauthorized", "Missing refresh token")
    stored = db.scalar(select(RefreshToken).where(RefreshToken.token_hash == hash_refresh_token(token)))
    now = datetime.now(UTC)
    if stored is None:
        raise ApiError(401, "unauthorized", "Invalid refresh token")
    if stored.revoked_at is not None:
        # A used token came back: someone may have copied it. Sign this user out everywhere.
        db.execute(
            update(RefreshToken)
            .where(RefreshToken.user_id == stored.user_id, RefreshToken.revoked_at.is_(None))
            .values(revoked_at=now)
        )
        db.commit()
        raise ApiError(401, "unauthorized", "Refresh token already used")
    if stored.expires_at.replace(tzinfo=stored.expires_at.tzinfo or UTC) < now:
        raise ApiError(401, "unauthorized", "Refresh token expired")
    user = db.get(User, stored.user_id)
    if user is None or not user.is_active:
        raise ApiError(401, "unauthorized", "Account disabled")
    stored.revoked_at = now
    return issue_tokens(db, user, response)


@app.post("/logout", status_code=204, tags=["sign in"])
def logout(request: Request, response: Response, db: Db, body: RefreshIn | None = None) -> Response:
    token = (body.refresh_token if body else None) or request.cookies.get(REFRESH_COOKIE)
    if token:
        db.execute(
            update(RefreshToken)
            .where(RefreshToken.token_hash == hash_refresh_token(token), RefreshToken.revoked_at.is_(None))
            .values(revoked_at=datetime.now(UTC))
        )
        db.commit()
    response.status_code = 204
    clear_cookies(response)
    return response


@app.get("/me", response_model=UserOut, tags=["sign in"])
def me(db: Db, principal: Principal = Depends(require_role("admin", "editor", "recruiter"))) -> UserOut:
    user = db.get(User, uuid.UUID(principal.sub))
    if user is None or not user.is_active:
        raise ApiError(401, "unauthorized", "Account disabled")
    return user_out(user)


@app.get("/jwks", tags=["keys"])
def jwks() -> dict:
    """The public key every service uses to check tokens."""
    return {"keys": [keys.jwk()]}


# Users of the caller's own company. Admins only.

AdminOnly = Annotated[Principal, Depends(require_role("admin"))]


def tenant_user(db: Session, admin: Principal, user_id: uuid.UUID) -> User:
    user = db.get(User, user_id)
    if user is None or user.tenant_id != admin.tenant_id:
        raise ApiError(404, "not_found", "User not found")
    return user


@app.get("/users", response_model=list[UserOut], tags=["users"])
def list_users(db: Db, admin: AdminOnly) -> list[UserOut]:
    users = db.scalars(select(User).where(User.tenant_id == admin.tenant_id).order_by(User.created_at))
    return [user_out(u) for u in users]


@app.post("/users", response_model=UserOut, status_code=201, tags=["users"])
def create_user(body: UserIn, db: Db, admin: AdminOnly) -> UserOut:
    user = User(
        tenant_id=admin.tenant_id,
        email=body.email.lower(),
        full_name=body.full_name,
        password_hash=hash_password(body.password),
        role=body.role,
        experience=body.experience,
    )
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise ApiError(409, "email_taken", "A user with this email already exists") from None
    db.refresh(user)
    return user_out(user)


@app.patch("/users/{user_id}", response_model=UserOut, tags=["users"])
def update_user(user_id: uuid.UUID, body: UserUpdate, db: Db, admin: AdminOnly) -> UserOut:
    user = tenant_user(db, admin, user_id)
    if str(user.id) == admin.sub and (body.role not in (None, "admin") or body.is_active is False):
        raise ApiError(400, "invalid_request", "You cannot remove your own admin access")
    if body.full_name is not None:
        user.full_name = body.full_name
    if body.role is not None:
        user.role = body.role
    if body.experience is not None:
        user.experience = body.experience
    if body.is_active is not None:
        user.is_active = body.is_active
    if body.password is not None:
        user.password_hash = hash_password(body.password)
    if body.password is not None or body.is_active is False:
        db.execute(
            update(RefreshToken)
            .where(RefreshToken.user_id == user.id, RefreshToken.revoked_at.is_(None))
            .values(revoked_at=datetime.now(UTC))
        )
    db.commit()
    return user_out(user)


# For other services only: the gateway never forwards /internal/.


@app.post("/internal/service-token", response_model=TokenOut, tags=["internal"])
def service_token(service: str = Header(alias="X-Service-Name"), secret: str = Header(alias="X-Service-Secret")):
    if not config.SERVICE_SECRET or not hmac.compare_digest(secret, config.SERVICE_SECRET):
        raise ApiError(401, "unauthorized", "Invalid service secret")
    return TokenOut(token=sign({"sub": service, "role": "service"}, config.SERVICE_TTL_SECONDS), expires_in=config.SERVICE_TTL_SECONDS)


@app.post("/internal/candidate-token", response_model=TokenOut, tags=["internal"])
def candidate_token(body: CandidateTokenIn, _: Principal = Depends(require_role("service"))) -> TokenOut:
    """The 7-day token in a candidate's test link: it opens that one session only."""
    token = sign(
        {
            "sub": str(body.candidate_id),
            "role": "candidate",
            "tenant_id": str(body.tenant_id),
            "session_id": str(body.session_id),
        },
        config.CANDIDATE_TTL_SECONDS,
    )
    return TokenOut(token=token, expires_in=config.CANDIDATE_TTL_SECONDS)


class NamesIn(BaseModel):
    ids: list[uuid.UUID] = Field(max_length=200)


@app.post("/internal/users/names", tags=["internal"])
def user_names(body: NamesIn, db: Db, _: Principal = Depends(require_role("service"))) -> dict[str, str]:
    """Who wrote what: the names (or emails) of these users, for notes shown to their team."""
    if not body.ids:
        return {}
    users = db.scalars(select(User).where(User.id.in_(body.ids)))
    return {str(u.id): u.full_name or u.email for u in users}


class ProfileOut(BaseModel):
    id: uuid.UUID
    name: str
    role: str
    experience: int
    tenant_id: uuid.UUID


@app.post("/internal/users/profiles", response_model=list[ProfileOut], tags=["internal"])
def user_profiles(body: NamesIn, db: Db, _: Principal = Depends(require_role("service"))) -> list[ProfileOut]:
    """Role and experience of these users, to decide who may validate whose questions."""
    if not body.ids:
        return []
    users = db.scalars(select(User).where(User.id.in_(body.ids), User.is_active.is_(True)))
    return [ProfileOut(id=u.id, name=u.full_name or u.email, role=u.role, experience=u.experience, tenant_id=u.tenant_id) for u in users]
