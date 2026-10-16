"""Client for the test library: each company's own questions, kept by the questions service."""

from rh_common import internal


class Library:
    def stock(self, tenant_id) -> list[dict]:
        """[{language, level, count}] of the company's approved questions; language is the skill's key."""
        return internal.call("GET", "questions", "/internal/stock", params={"tenant_id": str(tenant_id)})

    def draw(self, tenant_id, rows: list[dict]) -> list[dict]:
        """Draws questions for one candidate: rows of {language, level, count}. 409 not_enough_questions when short."""
        return internal.call("POST", "questions", "/internal/draw", json={"tenant_id": str(tenant_id), "rows": rows})

    def questions(self, ids: list) -> dict[str, dict]:
        """id → the question with its answer, whatever its status."""
        if not ids:
            return {}
        rows = internal.call("POST", "questions", "/internal/questions", json={"ids": [str(i) for i in ids]})
        return {q["id"]: q for q in rows}


_default = Library()


def library() -> Library:
    """FastAPI dependency (override it in tests)."""
    return _default
