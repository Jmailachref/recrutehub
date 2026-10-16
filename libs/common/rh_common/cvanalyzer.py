"""Client for CV Analyzer, which reads CVs and scores them against their offer's grid.

Configured with CV_ANALYZER_URL and CV_ANALYZER_KEY. An offer there is RecruteHub's job
offer (its id is the ref), and a CV there is one application (its external ref is the
candidate's id). Scores are points: the grid's keyword points plus the recruiters' points.
"""

import os

import httpx

from rh_common.errors import ApiError


class CvAnalyzer:
    def __init__(self, base_url: str | None = None, api_key: str | None = None, transport=None):
        self._client = httpx.Client(
            base_url=base_url or os.environ.get("CV_ANALYZER_URL", "http://cvanalyzer-api:8000"),
            headers={"Authorization": f"Bearer {api_key or os.environ.get('CV_ANALYZER_KEY', '')}"},
            timeout=30,
            transport=transport,
        )

    def _call(self, method: str, path: str, **kwargs):
        try:
            response = self._client.request(method, path, **kwargs)
        except httpx.HTTPError as exc:
            raise ApiError(502, "cv_analyzer_unavailable", "The CV analyzer is not reachable right now") from exc
        if response.status_code >= 400:
            error = (response.json().get("error") or {}) if response.content else {}
            if response.status_code >= 500:
                raise ApiError(502, "cv_analyzer_error", error.get("message", "The CV analyzer failed"))
            raise ApiError(response.status_code, error.get("code", "cv_analyzer_error"), error.get("message", ""))
        return response.json() if response.content else None

    # Offers and their grids

    def save_offer(self, ref: str, title: str, skills: list[dict], criteria: list[dict] | None = None, rebuild: bool = False) -> dict:
        """Creates or updates an offer. Without criteria the grid follows the skills and keeps a recruiter's edits."""
        body: dict = {"title": title, "skills": [{"name": s.get("label") or s["language"], "priority": s["priority"]} for s in skills]}
        if criteria is not None:
            body["criteria"] = criteria
        if rebuild:
            body["rebuild"] = True
        return self._call("PUT", f"/v1/offers/{ref}", json=body)

    def offer(self, ref: str) -> dict:
        """The offer with its current grid. 404 offer_not_found when it was never sent."""
        return self._call("GET", f"/v1/offers/{ref}")

    def delete_offer(self, ref: str) -> None:
        self._call("DELETE", f"/v1/offers/{ref}")

    def ranking(self, ref: str) -> list[dict]:
        """[{document_id, external_ref, status, auto, manual, total, missing, ...}], highest total first."""
        return self._call("GET", f"/v1/offers/{ref}/ranking")

    # CVs

    def upload(self, offer_ref: str, external_ref: str, filename: str, data: bytes) -> dict:
        return self._call(
            "POST",
            "/v1/documents",
            data={"offer_ref": offer_ref, "external_ref": external_ref},
            files={"file": (filename, data, "application/pdf")},
        )

    def document(self, document_id: str) -> dict:
        """The CV as read: status, text and lines (with their boxes on the PDF)."""
        return self._call("GET", f"/v1/documents/{document_id}")

    def score(self, document_id: str) -> dict:
        """auto, manual and total points, the analysis behind them and every highlight."""
        return self._call("GET", f"/v1/documents/{document_id}/score")

    def add_highlight(self, document_id: str, body: dict) -> dict:
        return self._call("POST", f"/v1/documents/{document_id}/highlights", json=body)

    def highlights(self, document_id: str) -> list[dict]:
        return self._call("GET", f"/v1/documents/{document_id}/highlights")

    def delete_highlight(self, highlight_id: str) -> None:
        self._call("DELETE", f"/v1/highlights/{highlight_id}")


_default: CvAnalyzer | None = None


def cvanalyzer() -> CvAnalyzer:
    """FastAPI dependency (override it in tests)."""
    global _default
    if _default is None:
        _default = CvAnalyzer()
    return _default
