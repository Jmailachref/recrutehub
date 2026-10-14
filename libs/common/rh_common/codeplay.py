"""Client for Code Playground, the question bank, test generator and code judge.

Configured with CODEPLAY_URL and CODEPLAY_API_KEY.
"""

import os

import httpx

from rh_common.errors import ApiError


class CodePlayground:
    def __init__(self, base_url: str | None = None, api_key: str | None = None, transport=None):
        self._client = httpx.Client(
            base_url=base_url or os.environ.get("CODEPLAY_URL", "http://codeplay-api:8000"),
            headers={"Authorization": f"Bearer {api_key or os.environ.get('CODEPLAY_API_KEY', '')}"},
            timeout=15,
            transport=transport,
        )

    def _call(self, method: str, path: str, **kwargs):
        try:
            response = self._client.request(method, path, **kwargs)
        except httpx.HTTPError as exc:
            raise ApiError(502, "codeplay_unavailable", "The question bank is not reachable right now") from exc
        if response.status_code >= 400:
            error = response.json().get("error", {}) if response.content else {}
            if response.status_code >= 500:
                raise ApiError(502, "codeplay_error", error.get("message", "The question bank failed"))
            raise ApiError(response.status_code, error.get("code", "codeplay_error"), error.get("message", ""))
        return response.json() if response.content else None

    def stock(self, language: str | None = None) -> list[dict]:
        """[{language, level, code, qcm}] counts of approved questions."""
        return self._call("GET", "/v1/stock", params={"language": language} if language else None)

    def create_test(self, recipe: list[dict], scope: str, external_ref: str) -> dict:
        """Draws and freezes one candidate's questions. 409 not_enough_questions when the bank is short."""
        return self._call("POST", "/v1/tests", json={"recipe": recipe, "scope": scope, "external_ref": external_ref})

    def test(self, test_id: str) -> dict:
        """The frozen test as the candidate sees it: no hidden test cases, no right answers."""
        return self._call("GET", f"/v1/tests/{test_id}")

    def problem_full(self, problem_id: str) -> dict:
        """One question with its right answers and hidden test cases."""
        return self._call("GET", f"/v1/problems/{problem_id}/full")

    def create_run(self, language: str, source_code: str, stdin: str, user_id: str) -> dict:
        return self._call(
            "POST", "/v1/runs", json={"language": language, "source_code": source_code, "stdin": stdin, "user_id": user_id}
        )

    def run(self, run_id: str) -> dict:
        return self._call("GET", f"/v1/runs/{run_id}")

    def create_submission(self, problem_id: str, language: str, source_code: str, user_id: str) -> dict:
        return self._call(
            "POST",
            "/v1/submissions",
            json={"problem_id": problem_id, "language": language, "source_code": source_code, "user_id": user_id},
        )

    def submission(self, submission_id: str) -> dict:
        return self._call("GET", f"/v1/submissions/{submission_id}")


_default: CodePlayground | None = None


def codeplay() -> CodePlayground:
    """FastAPI dependency (override it in tests)."""
    global _default
    if _default is None:
        _default = CodePlayground()
    return _default
