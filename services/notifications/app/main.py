import uuid
from datetime import datetime
from typing import Annotated

from fastapi import Depends, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import EmailLog
from rh_common import Principal, create_app, require_role
from rh_common.db import get_session

app = create_app("notifications")


class EmailOut(BaseModel):
    id: uuid.UUID
    template: str
    to: str
    subject: str
    status: str
    attempts: int
    error: str | None
    created_at: datetime
    sent_at: datetime | None


@app.get("/emails", response_model=list[EmailOut], tags=["emails"])
def list_emails(
    db: Annotated[Session, Depends(get_session)],
    admin: Annotated[Principal, Depends(require_role("admin"))],
    limit: int = Query(default=50, ge=1, le=200),
) -> list[EmailLog]:
    """The emails sent for the admin's company, newest first."""
    query = (
        select(EmailLog)
        .where(EmailLog.tenant_id == admin.tenant_id)
        .order_by(EmailLog.created_at.desc())
        .limit(limit)
    )
    return list(db.scalars(query))
