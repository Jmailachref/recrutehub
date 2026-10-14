"""The emails RecruteHub sends. Each template turns its data into a subject and a plain-text body."""

from collections.abc import Callable


def application_received(d: dict) -> tuple[str, str]:
    return (
        f"We received your application: {d['offer_title']}",
        f"Hello {d['name']},\n\n"
        f"Thank you for applying to {d['offer_title']}. We have your CV and will review it shortly.\n"
        "If your profile matches, you will get a second email with a link to a short online test.\n\n"
        "The RecruteHub team\n",
    )


def test_invite(d: dict) -> tuple[str, str]:
    return (
        f"Your test for {d['offer_title']}",
        f"Hello {d['name']},\n\n"
        f"Your profile was selected for {d['offer_title']}. Take the online test here:\n\n"
        f"{d['link']}\n\n"
        "The link works for 7 days. Set aside enough quiet time to finish in one go.\n\n"
        "The RecruteHub team\n",
    )


def test_confirmation(d: dict) -> tuple[str, str]:
    return (
        f"Test received: {d['offer_title']}",
        f"Hello {d['name']},\n\n"
        f"We received your answers for {d['offer_title']}. The recruiter will be in touch.\n\n"
        "The RecruteHub team\n",
    )


TEMPLATES: dict[str, Callable[[dict], tuple[str, str]]] = {
    "application_received": application_received,
    "test_invite": test_invite,
    "test_confirmation": test_confirmation,
}
