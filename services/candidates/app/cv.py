"""Each application's CV goes to the CV analyzer, which reads it and scores it in points."""

import logging
import uuid

from sqlalchemy.orm import Session

from app import storage
from app.models import Candidate
from rh_common import ApiError, internal
from rh_common.cvanalyzer import CvAnalyzer

log = logging.getLogger(__name__)


def send_cv(db: Session, c: Candidate, analyzer: CvAnalyzer) -> uuid.UUID:
    """Uploads the CV once, sending its offer first if the analyzer does not have it yet."""
    if c.cv_document_id is not None:
        return c.cv_document_id
    data = storage.get_pdf(c.cv_key)
    try:
        document = analyzer.upload(str(c.offer_id), str(c.id), "cv.pdf", data)
    except ApiError as exc:
        if exc.code != "offer_not_found":
            raise
        offer = internal.call("GET", "offers", f"/internal/offers/{c.offer_id}")
        analyzer.save_offer(str(c.offer_id), offer["title"], offer["skills"])
        document = analyzer.upload(str(c.offer_id), str(c.id), "cv.pdf", data)
    c.cv_document_id = uuid.UUID(document["id"])
    db.commit()
    return c.cv_document_id


def handle_send_cv(job: dict, db: Session, analyzer: CvAnalyzer) -> None:
    c = db.get(Candidate, uuid.UUID(job["candidate_id"]))
    if c is not None:
        send_cv(db, c, analyzer)


def points_by_candidate(analyzer: CvAnalyzer, offer_ids: set[uuid.UUID]) -> dict[str, dict]:
    """Each candidate's CV points ({total, auto, manual, status}) for these offers. Empty when the analyzer is down."""
    rows: dict[str, dict] = {}
    for offer_id in offer_ids:
        try:
            ranking = analyzer.ranking(str(offer_id))
        except ApiError as exc:
            if exc.code != "offer_not_found":
                log.warning("no CV points for offer %s: %s", offer_id, exc.message)
            continue
        for row in ranking:
            if row.get("external_ref"):
                rows[row["external_ref"]] = row
    return rows
