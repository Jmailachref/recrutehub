"""Builds a first test recipe from the skills a recruiter picked.

Priorities 1 (core), 2 (important) and 3 (secondary) share the question
budget 3:2:1. Each skill takes the level closest to 3 that has questions,
then splits its share 60% QCM, 40% code, within what the bank has. Questions
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
        if s and s["code"] + s["qcm"] > 0:
            return level
    return None


def split(total: int, s: dict) -> tuple[int, int]:
    """(code, qcm) for `total` questions: 40% code, and whatever one type lacks goes to the other."""
    code = min(total * 2 // 5, s["code"])
    qcm = min(total - code, s["qcm"])
    code = min(total - qcm, s["code"])
    return code, qcm


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
        code, qcm = split(share, stock[(language, level)])
        rows.append({"language": language, "level": level, "code_count": code, "qcm_count": qcm})
        wanted.append(share)

    # Hand questions a skill could not fill to the others, core skills first.
    missing = budget - sum(r["code_count"] + r["qcm_count"] for r in rows)
    for row, share in zip(rows, wanted):
        if row["code_count"] + row["qcm_count"] < share:
            got = row["code_count"] + row["qcm_count"]
            warnings.append(
                {"code": "stock_reduced", "skill": row["language"], "message": f"Only {got} of {share} questions available at level {row['level']}"}
            )
    for row in rows:
        if missing <= 0:
            break
        s = stock[(row["language"], row["level"])]
        have = row["code_count"] + row["qcm_count"]
        code, qcm = split(min(have + missing, s["code"] + s["qcm"]), s)
        missing -= code + qcm - have
        row["code_count"], row["qcm_count"] = code, qcm
    return rows, warnings
