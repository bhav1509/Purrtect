"""Rule-based scoring from shared/rules.json. Python port of score() in extension/rules.js;
tests/run_tests.py checks the two agree."""
from __future__ import annotations

import json
import re
from pathlib import Path
from urllib.parse import urlsplit

RULES_PATH = Path(__file__).resolve().parent.parent / "shared" / "rules.json"

_URL_RE = re.compile(
    r"\b((?:https?://|www\.)[^\s<>\"')\]]+|(?:[a-z0-9-]+\.)+[a-z]{2,}(?:/[^\s<>\"')\]]*)?)", re.I | re.A
)
_IP_HOST_RE = re.compile(r"^\d{1,3}(?:\.\d{1,3}){3}$")


def load_rules(path: Path = RULES_PATH) -> dict:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def _term_matches(text: str, term: str) -> bool:
    t = term.lower()
    if not t.isascii():
        return t in text
    return re.search(r"(^|[^a-z0-9])" + re.escape(t) + r"($|[^a-z0-9])", text) is not None


def extract_links(text: str) -> list[str]:
    hosts = []
    for m in _URL_RE.finditer(text or ""):
        raw = m.group(1).rstrip(".,;:!?")
        with_scheme = raw if re.match(r"^https?://", raw, re.I) else "http://" + raw
        try:
            host = (urlsplit(with_scheme).hostname or "").lower()
        except ValueError:
            continue
        host = re.sub(r"^www\.", "", host)
        if "." in host:
            hosts.append(host)
    return hosts


def _host_matches(host: str, domain: str) -> bool:
    return host == domain or host.endswith("." + domain)


def _looks_like_brand(host: str, brand: dict) -> bool:
    squashed = host.replace("0", "o").replace("1", "l").replace("-", "").replace("_", "")
    for d in brand["domains"]:
        label = d.split(".")[0]
        if len(label) >= 4 and label in squashed:
            return True
    return False


def score(text: str, rules: dict) -> dict:
    lower = (text or "").lower()
    P = rules["points"]
    reasons = []
    total = 0

    def add(code, pts, detail):
        nonlocal total
        total += pts
        reasons.append({"code": code, "points": pts, "detail": detail})

    for category, cfg in rules["keywords"].items():
        hits = [t for t in cfg["terms"] if _term_matches(lower, t)]
        if hits:
            cap = P["max_per_category"]
            add("keyword_" + category, max(-cap, min(len(hits) * cfg["points"], cap)), ", ".join(hits[:3]))

    seen: list[str] = []
    for host in extract_links(text):
        if host in seen:
            continue
        seen.append(host)
        if _IP_HOST_RE.match(host):
            add("ip_address_link", P["ip_address_link"], host)
        if any(part.startswith("xn--") for part in host.split(".")):
            add("punycode_link", P["punycode_link"], host)
        if any(host.endswith(e) for e in rules["risky_domain_endings"]):
            add("risky_domain_ending", P["risky_domain_ending"], host)
        if any(_host_matches(host, s) for s in rules["url_shorteners"]):
            add("url_shortener", P["url_shortener"], host)
        for brand in rules["brands"]:
            official = any(_host_matches(host, d) for d in brand["domains"])
            if not official and _looks_like_brand(host, brand):
                add("lookalike_domain", P["lookalike_domain"], f"{host} ≠ {brand['name']}")
    if len(seen) >= 4:
        add("many_links", P["many_links"], str(len(seen)))

    # Brand named in the text, but links point somewhere that brand doesn't own.
    if seen:
        for brand in rules["brands"]:
            if not any(_term_matches(lower, a) for a in brand["aliases"]):
                continue
            offsite = [h for h in seen if not any(_host_matches(h, d) for d in brand["domains"])]
            if len(offsite) == len(seen):
                add("brand_impersonation", P["brand_impersonation"], f"{brand['name']} → {offsite[0]}")
                break

    total = max(0, min(total, 100))
    t = rules["thresholds"]
    verdict = "dangerous" if total >= t["dangerous"] else "suspicious" if total >= t["suspicious"] else "safe"
    return {"score": total, "verdict": verdict, "reasons": reasons, "links": seen}
