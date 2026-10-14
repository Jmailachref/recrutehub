"""Checks the JWTs that the auth service signs (RS256).

Every service reads auth's public key from its JWKS endpoint (AUTH_JWKS_URL)
once and caches it, so checking a token needs no call to auth.
"""

import os
from dataclasses import dataclass
from functools import lru_cache
from uuid import UUID

import jwt
from fastapi import Depends, Request

from rh_common.errors import ApiError

ISSUER = "recrutehub-auth"
ROLES = {"admin", "recruiter", "candidate", "service"}


@dataclass(frozen=True)
class Principal:
    sub: str
    role: str
    tenant_id: UUID | None
    session_id: UUID | None = None


@lru_cache
def _jwks_client() -> jwt.PyJWKClient:
    return jwt.PyJWKClient(os.environ["AUTH_JWKS_URL"], cache_keys=True, lifespan=3600)


def signing_key(token: str):
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
    """FastAPI dependency: the caller, from the Bearer token."""
    header = request.headers.get("authorization", "")
    scheme, _, token = header.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise ApiError(401, "unauthorized", "Missing bearer token")
    return decode(token)


def require_role(*roles: str):
    """FastAPI dependency factory: the caller must have one of these roles."""

    def check(principal: Principal = Depends(current_principal)) -> Principal:
        if principal.role not in roles:
            raise ApiError(403, "forbidden", "This action is not allowed for your role")
        return principal

    return check
