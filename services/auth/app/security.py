"""Passwords, token signing and login throttling."""

import hashlib
import secrets
import time
import uuid
from collections import defaultdict

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import VerificationError

from app import config, keys
from rh_common.tokens import ISSUER

_hasher = PasswordHasher()
# Checked when the email is unknown, so a wrong email takes as long as a wrong password.
_DUMMY_HASH = _hasher.hash("not-a-real-password")


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def check_password(password_hash: str | None, password: str) -> bool:
    try:
        return _hasher.verify(password_hash or _DUMMY_HASH, password) and password_hash is not None
    except VerificationError:
        return False


def sign(claims: dict, ttl_seconds: int) -> str:
    now = int(time.time())
    body = {"iss": ISSUER, "iat": now, "exp": now + ttl_seconds, "jti": uuid.uuid4().hex, **claims}
    return jwt.encode(body, keys.private_key(), algorithm="RS256", headers={"kid": keys.jwk()["kid"]})


def new_refresh_token() -> tuple[str, str]:
    """A random token and the hash to store."""
    token = secrets.token_urlsafe(32)
    return token, hash_refresh_token(token)


def hash_refresh_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


class LoginThrottle:
    """Counts failed logins per email; Redis when configured, else in memory (tests)."""

    def __init__(self):
        self._memory: dict[str, list[float]] = defaultdict(list)

    def _redis(self):
        import os

        if not os.environ.get("REDIS_URL"):
            return None
        from rh_common.queue import client

        return client()

    def blocked(self, email: str) -> bool:
        r = self._redis()
        if r is not None:
            return int(r.get(f"rh:auth:fail:{email}") or 0) >= config.LOGIN_MAX_FAILURES
        cutoff = time.time() - config.LOGIN_WINDOW_SECONDS
        self._memory[email] = [t for t in self._memory[email] if t > cutoff]
        return len(self._memory[email]) >= config.LOGIN_MAX_FAILURES

    def failed(self, email: str) -> None:
        r = self._redis()
        if r is not None:
            key = f"rh:auth:fail:{email}"
            if r.incr(key) == 1:
                r.expire(key, config.LOGIN_WINDOW_SECONDS)
            return
        self._memory[email].append(time.time())

    def reset(self, email: str) -> None:
        r = self._redis()
        if r is not None:
            r.delete(f"rh:auth:fail:{email}")
        else:
            self._memory.pop(email, None)


throttle = LoginThrottle()
