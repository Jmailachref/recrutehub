"""Checks the JWTs that the auth service signs (RS256).

Every service reads auth's public key from its JWKS endpoint (AUTH_JWKS_URL)
once and caches it, so checking a token needs no call to auth. The browser
sends the token in the rh_access cookie; other callers use a Bearer header.
"""

import os
from dataclasses import dataclass
from functools import lru_cache
from uuid import UUID

import jwt
from fastapi import Depends, Request

from rh_common.errors import ApiError

ISSUER = "recrutehub-auth"
ROLES = {"admin", "editor", "recruiter", "candidate", "service"}
ACCESS_COOKIE = "rh_access"
_local_key = None


@dataclass(frozen=True)
class Principal:
    sub: str
    role: str
    tenant_id: UUID | None
    session_id: UUID | None = None


@lru_cache
def _jwks_client() -> jwt.PyJWKClient:
    return jwt.PyJWKClient(os.environ["AUTH_JWKS_URL"], cache_keys=True, lifespan=3600)


def use_local_key(public_key) -> None:
    """Checks tokens with this key instead of fetching the JWKS (the auth service itself)."""
    global _local_key
    _local_key = public_key


def signing_key(token: str):
    if _local_key is not None:
        return _local_key
    return _jwks_client().get_signing_key_from_jwt(token).key


def decode(token: str, key=None) -> Principal:
    try:
        claims = jwt.decode(
            token,
            key if key is not None else signing_key(token),
            algorithms=["RS256"],
            issuer=ISSUER,
            options={"require": ["sub", "role", "exp", "iss"]},
        )
    except jwt.PyJWTError as exc:
        raise ApiError(401, "unauthorized", f"Invalid token: {exc}") from exc
    if claims["role"] not in ROLES:
        raise ApiError(401, "unauthorized", "Invalid token: unknown role")
    return Principal(
        sub=claims["sub"],
        role=claims["role"],
        tenant_id=UUID(claims["tenant_id"]) if claims.get("tenant_id") else None,
        session_id=UUID(claims["session_id"]) if claims.get("session_id") else None,
    )


def current_principal(request: Request) -> Principal:
    """FastAPI dependency: the caller, from the Bearer header or the rh_access cookie."""
    scheme, _, token = request.headers.get("authorization", "").partition(" ")
    if scheme.lower() != "bearer" or not token:
        token = request.cookies.get(ACCESS_COOKIE, "")
    if not token:
        raise ApiError(401, "unauthorized", "Not signed in")
    return decode(token)


def require_role(*roles: str):
    """FastAPI dependency factory: the caller must have one of these roles."""

    def check(principal: Principal = Depends(current_principal)) -> Principal:
        if principal.role not in roles:
            raise ApiError(403, "forbidden", "This action is not allowed for your role")
        return principal

    return check
