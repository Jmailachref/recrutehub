"""Database access. Each service connects to its own database through DATABASE_URL."""

import os
from collections.abc import Iterator
from functools import lru_cache

from sqlalchemy import Engine, create_engine, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker


class Base(DeclarativeBase):
    pass


@lru_cache
def engine() -> Engine:
    return create_engine(os.environ["DATABASE_URL"], pool_pre_ping=True)


@lru_cache
def _sessions() -> sessionmaker[Session]:
    return sessionmaker(engine(), expire_on_commit=False)


def get_session() -> Iterator[Session]:
    """FastAPI dependency: one session per request."""
    with _sessions()() as session:
        yield session


def database_ok() -> bool:
    try:
        with engine().connect() as conn:
            conn.execute(text("SELECT 1"))
        return True
    except Exception:
        return False
