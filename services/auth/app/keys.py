"""The RSA key pair that signs every RecruteHub token.

The private key is read from AUTH_PRIVATE_KEY_FILE. When the file does not
exist yet (first start in development) a key is generated and saved there,
on a volume, so tokens survive restarts.
"""

import base64
import hashlib
import os
from functools import lru_cache
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

from app import config


def _b64(n: int) -> str:
    raw = n.to_bytes((n.bit_length() + 7) // 8, "big")
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


@lru_cache
def private_key() -> rsa.RSAPrivateKey:
    path = Path(config.PRIVATE_KEY_FILE)
    if not path.exists():
        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        path.parent.mkdir(parents=True, exist_ok=True)
        pem = key.private_bytes(
            serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()
        )
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "wb") as f:
            f.write(pem)
    return serialization.load_pem_private_key(path.read_bytes(), password=None)


@lru_cache
def jwk() -> dict:
    numbers = private_key().public_key().public_numbers()
    kid = hashlib.sha256(f"{numbers.n}:{numbers.e}".encode()).hexdigest()[:16]
    return {"kty": "RSA", "use": "sig", "alg": "RS256", "kid": kid, "n": _b64(numbers.n), "e": _b64(numbers.e)}
