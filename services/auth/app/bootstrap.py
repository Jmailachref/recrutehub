"""Creates a company and its first admin.

    python -m app.bootstrap "Acme" admin@acme.com 'a long password'

With no arguments, uses BOOTSTRAP_TENANT / BOOTSTRAP_ADMIN_EMAIL /
BOOTSTRAP_ADMIN_PASSWORD and does nothing if that email already exists
(how docker compose creates the development admin on every start).
"""

import os
import sys

from sqlalchemy import select

from app.models import Tenant, User
from app.security import hash_password
from rh_common.db import _sessions


def bootstrap(tenant_name: str, email: str, password: str) -> bool:
    with _sessions()() as db:
        if db.scalar(select(User).where(User.email == email.lower())):
            return False
        tenant = Tenant(name=tenant_name)
        db.add(tenant)
        db.flush()
        db.add(User(tenant_id=tenant.id, email=email.lower(), full_name="Admin", password_hash=hash_password(password), role="admin"))
        db.commit()
        return True


if __name__ == "__main__":
    if len(sys.argv) == 4:
        args = sys.argv[1:]
    elif os.environ.get("BOOTSTRAP_ADMIN_EMAIL"):
        args = [os.environ.get("BOOTSTRAP_TENANT", "Demo company"), os.environ["BOOTSTRAP_ADMIN_EMAIL"], os.environ["BOOTSTRAP_ADMIN_PASSWORD"]]
    else:
        sys.exit(0)
    created = bootstrap(*args)
    print(f"{'Created' if created else 'Already exists:'} {args[1]}")
