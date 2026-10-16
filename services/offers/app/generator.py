"""Builds a first test recipe from the skills a recruiter picked.

Priorities 1 (core), 2 (important) and 3 (secondary) share the question
budget 3:2:1. Each skill takes the level closest to 3 that has questions,
then splits its share 40% code and 60% theory, within what the banks have:
the company's own library questions first, then Code Playground's QCM. Questions
a skill cannot fill go to the other skills, core ones first. Priorities 4 and
5 are kept on the offer but get no questions.
"""

PRIORITY_SHARE = {1: 3, 2: 2, 3: 1}
LEVEL_ORDER = (3, 4, 2, 5, 1)


def shares(budget: int, priorities: list[int]) -> list[int]:
    """Splits the budget by priority weight (largest remainder), at least one question each when it fits."""
    weights = [PRIORITY_SHARE[p] for p in priorities]
    if not weights:
        return []
    exact = [budget * w / sum(weights) for w in weights]
    counts = [int(x) for x in exact]
    by_remainder = sorted(range(len(exact)), key=lambda i: (counts[i] - exact[i], priorities[i]))
    for i in by_remainder[: budget - sum(counts)]:
        counts[i] += 1
    for i, n in enumerate(counts):
        if n == 0:
            donor = max(range(len(counts)), key=lambda j: counts[j])
            if counts[donor] > 1:
                counts[donor] -= 1
                counts[i] = 1
    return counts


def pick_level(language: str, stock: dict[tuple[str, int], dict]) -> int | None:
    for level in LEVEL_ORDER:
        s = stock.get((language, level))
        if s and size(s) > 0:
            return level
    return None


def size(s: dict) -> int:
    return s["code"] + s["qcm"] + s.get("library", 0)


def split(total: int, s: dict) -> tuple[int, int, int]:
    """(code, qcm, library) for `total` questions: 40% code, the rest theory, and whatever one type lacks goes to the others."""
    code = min(total * 2 // 5, s["code"])
    library = min(total - code, s.get("library", 0))
    qcm = min(total - code - library, s["qcm"])
    code = min(total - library - qcm, s["code"])
    return code, qcm, library


def count(row: dict) -> int:
    return row["code_count"] + row["qcm_count"] + row["library_count"]


def generate(skills: list[dict], budget: int, stock: dict[tuple[str, int], dict]) -> tuple[list[dict], list[dict]]:
    """Returns (rows, warnings). Rows follow priority order; warnings name the skill they are about."""
    tested = sorted((s for s in skills if s["priority"] <= 3), key=lambda s: s["priority"])
    rows, warnings, wanted = [], [], []
    for skill, share in zip(tested, shares(budget, [s["priority"] for s in tested])):
        language = skill["language"]
        level = pick_level(language, stock)
        if level is None:
            warnings.append({"code": "no_stock", "skill": language, "message": "No questions in the bank: left out of the test"})
            continue
        if level != 3:
            warnings.append({"code": "level_adjusted", "skill": language, "message": f"No level 3 questions: level {level} used instead"})
        code, qcm, library = split(share, stock[(language, level)])
        rows.append({"language": language, "level": level, "code_count": code, "qcm_count": qcm, "library_count": library})
        wanted.append(share)

    # Hand questions a skill could not fill to the others, core skills first.
    missing = budget - sum(count(r) for r in rows)
    for row, share in zip(rows, wanted):
        if count(row) < share:
            got = count(row)
            warnings.append(
                {"code": "stock_reduced", "skill": row["language"], "message": f"Only {got} of {share} questions available at level {row['level']}"}
            )
    for row in rows:
        if missing <= 0:
            break
        s = stock[(row["language"], row["level"])]
        have = count(row)
        code, qcm, library = split(min(have + missing, size(s)), s)
        missing -= code + qcm + library - have
        row["code_count"], row["qcm_count"], row["library_count"] = code, qcm, library
    return rows, warnings
