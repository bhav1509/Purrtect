"""Verified country contacts, and removal of any phone number, website or email in model
output that is not in that country's row of countries.json."""
from __future__ import annotations

import json
import re
from pathlib import Path
from urllib.parse import urlsplit

COUNTRIES: dict = {
    code: row
    for code, row in json.loads((Path(__file__).parent / "countries.json").read_text(encoding="utf-8")).items()
    if not code.startswith("_")
}

REPLACEMENT = "(see the official contacts)"

_EMAIL_RE = re.compile(r"\b[\w.+-]+@([\w-]+(?:\.[\w-]+)+)\b", re.A)
_URL_RE = re.compile(r"\b(?:https?://)?((?:[a-z0-9-]+\.)+[a-z]{2,})(?:/[^\s)\]]*)?", re.A | re.I)
_NUMBER_RE = re.compile(r"#?\+?\d(?:[\d \-]*\d)?", re.A)
_CURRENCY_BEFORE = re.compile(r"(?:₹|\$|¥|€|£|₱|rs\.?|inr|rp\.?|idr|php|sgd|aud|usd|jpy)\s*$", re.I)


def _entries(row: dict) -> list[dict]:
    return row.get("call_first", []) + row.get("report_online", []) + row.get("other", [])


def _strip_www(host: str) -> str:
    return re.sub(r"^www\.", "", host.lower())


def _digits(s: str) -> str:
    return ("#" if s.lstrip().startswith("#") else "") + re.sub(r"\D", "", s)


def allowed_numbers(row: dict | None) -> set[str]:
    return {_digits(e["number"]) for e in _entries(row or {}) if e.get("number")}


def allowed_domains(row: dict | None) -> set[str]:
    hosts = set()
    for e in _entries(row or {}):
        if e.get("url"):
            hosts.add(_strip_www(urlsplit(e["url"]).hostname or ""))
        if e.get("email"):
            hosts.add(e["email"].split("@")[1].lower())
    return hosts


def _host_allowed(host: str, allowed: set[str]) -> bool:
    host = _strip_www(host)
    return any(host == d or host.endswith("." + d) for d in allowed)


def _number_allowed(candidate: str, allowed: set[str]) -> bool:
    if len(re.sub(r"\D", "", candidate)) < 3:
        return True  # "10 minutes", "24/7"
    pieces = re.split(r"[ \-]+", candidate.strip())
    for k in range(len(pieces), 0, -1):  # "1930 24" -> "1930" plus a short trailing number
        if _digits(" ".join(pieces[:k])) in allowed and all(len(re.sub(r"\D", "", p)) < 3 for p in pieces[k:]):
            return True
    return False


def strip_unverified(text: str, row: dict | None) -> str:
    """Remove contact details that are not in the country's verified row."""
    numbers, domains = allowed_numbers(row), allowed_domains(row)

    def email(m: re.Match) -> str:
        return m.group(0) if _host_allowed(m.group(1), domains) else REPLACEMENT

    def url(m: re.Match) -> str:
        return m.group(0) if _host_allowed(m.group(1), domains) else REPLACEMENT

    def number(m: re.Match) -> str:
        cand = m.group(0)
        before = text_ref[0][max(0, m.start() - 5):m.start()]
        after = text_ref[0][m.end():m.end() + 1]
        digits = re.sub(r"\D", "", cand)
        if _CURRENCY_BEFORE.search(before) or after == "%" or re.fullmatch(r"(19|20)\d\d", digits) \
                or re.fullmatch(r"\d{4}-\d{2}-\d{2}", cand):
            return cand
        return cand if _number_allowed(cand, numbers) else REPLACEMENT

    out = _EMAIL_RE.sub(email, text or "")
    out = _URL_RE.sub(url, out)
    text_ref = [out]
    return _NUMBER_RE.sub(number, out)
