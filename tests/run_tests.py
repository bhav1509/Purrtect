#!/usr/bin/env python3
"""Purrtect tests. Needs Python 3.8+ and Node.js (for extension/rules.js). No pip packages.

  python3 tests/run_tests.py                                  offline checks
  python3 tests/run_tests.py --api http://localhost:8080      also send the 30 samples to the backend
  python3 tests/run_tests.py --api https://purrtect-api-....run.app

Offline: local rules on the 30 samples (as Auto mode would score them), masking (Python and
JavaScript must agree), helpline filtering, and that shared files are synced.
With --api: scams caught out of 20, genuine messages wrongly flagged out of 10, average time.
Each --api run calls Gemini 30 times (paid from the project's credits).
"""
from __future__ import annotations

import argparse
import filecmp
import json
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))

from contacts import COUNTRIES, REPLACEMENT, strip_unverified  # noqa: E402
from masking import mask  # noqa: E402

SAMPLES = json.loads((ROOT / "tests" / "samples.json").read_text(encoding="utf-8"))
SCAMS = [s for s in SAMPLES if s["label"] == "scam"]
GENUINE = [s for s in SAMPLES if s["label"] == "genuine"]
COUNTRY_OF = {"en": "IN", "hi": "IN", "ta": "IN", "ja": "JP", "zh": "SG", "id": "ID"}
UI_LANG = {"hi": "hi", "ja": "ja", "zh": "zh"}

failures: list[str] = []


def check(ok: bool, message: str) -> None:
    print(("  ok    " if ok else "  FAIL  ") + message)
    if not ok:
        failures.append(message)


def node_run(script: str, payload: dict) -> dict:
    node = shutil.which("node")
    if not node:
        raise RuntimeError("Node.js is needed to run extension/rules.js")
    proc = subprocess.run([node, "-e", script, str(ROOT / "extension" / "rules.js")],
                          input=json.dumps(payload), capture_output=True, text=True, encoding="utf-8")
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip()[:500])
    return json.loads(proc.stdout)


SCORE_JS = """
const R = require(process.argv[1]);
const input = JSON.parse(require("fs").readFileSync(0, "utf8"));
const out = { scores: {}, masked: {} };
for (const s of input.samples) {
  out.scores[s.id] = R.scoreMessage({ text: s.text, scanText: s.sender.isNew, sender: s.sender }, input.rules, "normal");
}
for (const [i, t] of input.texts.entries()) out.masked[i] = R.mask(t);
process.stdout.write(JSON.stringify(out));
"""

MASK_CASES = [
    ("Call me on +91 98765 43210", "[PHONE]", "98765"),
    ("my number is 9876543210", "[PHONE]", "9876543210"),
    ("携帯 090-1234-5678 まで", "[PHONE]", "5678"),
    ("hubungi 081234567890", "[PHONE]", "081234567890"),
    ("card 4111 1111 1111 1111 exp 12/27", "[CARD]", "4111"),
    ("Aadhaar 1234 5678 9012", "[ID]", "9012"),
    ("PAN ABCDE1234F", "[ID]", "ABCDE1234F"),
    ("NRIC S1234567D", "[ID]", "S1234567D"),
    ("write to ravi.k@example.com", "[EMAIL]", "ravi.k@"),
    ("Your OTP is 482913", "[OTP]", "482913"),
    ("482913 is your OTP for login", "[OTP]", "482913"),
    ("验证码：556677", "[OTP]", "556677"),
    ("a/c 001234567890123", "[ACCOUNT]", "001234567890123"),
]


def test_sync() -> None:
    print("shared files in sync (run scripts/sync.sh if this fails)")
    pairs = [("shared/rules.json", "extension/rules.json"), ("shared/rules.json", "web/rules.json"),
             ("extension/rules.js", "web/rules.js")]
    pairs += [(f"extension/ui/{f}", f"web/ui/{f}") for f in ("core.js", "verdict-card.js", "recovery-panel.js", "ui.css")]
    for a, b in pairs:
        check((ROOT / b).exists() and filecmp.cmp(ROOT / a, ROOT / b, shallow=False), f"{b} matches {a}")
    for d in ("_locales", "mascots"):
        cmp = filecmp.dircmp(ROOT / "extension" / d, ROOT / "web" / d)
        check(not (cmp.left_only or cmp.right_only or cmp.diff_files or any(c.diff_files or c.left_only for c in cmp.subdirs.values())),
              f"web/{d} matches extension/{d}")


def test_local_rules() -> None:
    print("\nlocal rules (Auto mode: yellow and red go to Gemini, green stays in the browser)")
    rules = json.loads((ROOT / "shared" / "rules.json").read_text(encoding="utf-8"))
    out = node_run(SCORE_JS, {"rules": rules, "samples": SAMPLES, "texts": [c[0] for c in MASK_CASES] + [s["text"] for s in SAMPLES]})
    scores = {int(k): v for k, v in out["scores"].items()}
    caught = [s["id"] for s in SCAMS if scores[s["id"]]["level"] != "green"]
    flagged = [s["id"] for s in GENUINE if scores[s["id"]]["level"] != "green"]
    for s in SAMPLES:
        r = scores[s["id"]]
        print(f"    #{s['id']:>2} {s['label']:<7} {s['lang']:<2} {r['level']:<6} {r['score']:>3}  {','.join(r['hits'])}")
    print(f"  scams sent on for checking: {len(caught)}/{len(SCAMS)}; genuine wrongly flagged: {len(flagged)}/{len(GENUINE)}")
    check(len(caught) >= 18, "local rules flag at least 18 of 20 scams")
    check(len(flagged) <= 1, "local rules flag at most 1 of 10 genuine messages")

    print("\nmasking: JavaScript and Python agree")
    texts = [c[0] for c in MASK_CASES] + [s["text"] for s in SAMPLES]
    diff = [t for i, t in enumerate(texts) if out["masked"][str(i)] != mask(t)]
    for t in diff:
        print(f"    differs: {t[:70]!r}")
    check(not diff, f"rules.js mask() and masking.py give identical output on {len(texts)} texts")


def test_masking() -> None:
    print("\nmasking examples")
    for text, tag, secret in MASK_CASES:
        out = mask(text)
        check(tag in out and secret not in out, f"{text!r} -> {out!r}")
    keep = "Go to http://sbi-kyc-update.click/yono now"
    check(mask(keep) == keep, "links stay readable")


def test_contacts() -> None:
    print("\nhelpline filtering (only numbers and sites from countries.json survive)")
    cases = [
        ("IN", "Call 1930 now, 24/7.", "Call 1930 now, 24/7."),
        ("IN", "Call your bank on 1800-222-333.", f"Call your bank on {REPLACEMENT}."),
        ("IN", "Report at https://cybercrime.gov.in today.", "Report at https://cybercrime.gov.in today."),
        ("IN", "Visit fake-recovery.top for help.", f"Visit {REPLACEMENT} for help."),
        ("IN", "You paid ₹5000 about 10 minutes ago.", "You paid ₹5000 about 10 minutes ago."),
        ("JP", "Call #9110, or 110 in an emergency.", "Call #9110, or 110 in an emergency."),
        ("SG", "Overseas: +65 6869 1799.", "Overseas: +65 6869 1799."),
        ("ID", "WhatsApp OJK 081157157157 or konsumen@ojk.go.id", "WhatsApp OJK 081157157157 or konsumen@ojk.go.id"),
        ("ID", "Email help@ojk-refund.com", f"Email {REPLACEMENT}"),
    ]
    for code, text, want in cases:
        got = strip_unverified(text, COUNTRIES[code])
        check(got == want, f"{code} {text!r} -> {got!r}")
    check(sorted(COUNTRIES) == ["AU", "ID", "IN", "JP", "PH", "SG"], "countries.json has the 6 demo countries")


def post(url: str, body: dict) -> tuple[int, dict]:
    req = urllib.request.Request(url, json.dumps(body).encode(), {"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.load(r)
    except urllib.error.HTTPError as e:
        return e.code, {}


def test_api(base: str) -> None:
    base = base.rstrip("/")
    print(f"\nbackend {base}")
    try:
        with urllib.request.urlopen(base + "/health", timeout=30) as r:
            health = json.load(r)
    except OSError as e:
        check(False, f"/health reachable ({e})")
        return
    print(f"  model {health.get('model')}, AI configured: {health.get('ai_configured')}")
    rules = json.loads((ROOT / "shared" / "rules.json").read_text(encoding="utf-8"))
    scores = {int(k): v for k, v in node_run(SCORE_JS, {"rules": rules, "samples": SAMPLES, "texts": []})["scores"].items()}

    verdicts, times, errors = {}, [], []
    for s in SAMPLES:
        local = scores[s["id"]]
        body = {
            "text": mask(s["text"]), "links": [mask(l["url"]) for l in local["links"]],
            "sender": "new" if s["sender"]["isNew"] else "known", "source": s["source"],
            "local_score": local["score"], "local_hits": local["hits"],
            "ui_lang": UI_LANG.get(s["lang"], "en"), "country": COUNTRY_OF.get(s["lang"], "IN"),
        }
        started = time.monotonic()
        status, data = post(base + "/api/scan", body)
        times.append(time.monotonic() - started)
        if status != 200:
            errors.append(s["id"])
            print(f"    #{s['id']:>2} HTTP {status}")
            continue
        verdicts[s["id"]] = data["verdict"]
        print(f"    #{s['id']:>2} {s['label']:<7} {data['verdict']:<10} {times[-1]:4.1f}s  {data['headline']}")

    caught = sum(1 for s in SCAMS if verdicts.get(s["id"]) in ("suspicious", "scam"))
    flagged = sum(1 for s in GENUINE if verdicts.get(s["id"]) in ("suspicious", "scam"))
    avg = sum(times) / len(times)
    print(f"\n  RESULT: scams caught {caught}/{len(SCAMS)}, genuine wrongly flagged {flagged}/{len(GENUINE)}, "
          f"average verdict time {avg:.1f}s, errors {len(errors)}")
    check(not errors, "every request answered (no 503 / timeouts)")
    check(avg < 3.0, "average verdict time under 3 s")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--api", help="backend base URL, e.g. http://localhost:8080")
    args = parser.parse_args()

    test_sync()
    test_local_rules()
    test_masking()
    test_contacts()
    if args.api:
        test_api(args.api)
    print("\n" + (f"FAILED: {len(failures)}" if failures else "all passed"))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
