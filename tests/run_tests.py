#!/usr/bin/env python3
"""Purrtect test runner (stdlib only).

  python tests/run_tests.py                          rules, JS/Python parity, masking
  python tests/run_tests.py --api http://localhost:8000   also score every sample through /api/scan

Exits non-zero on failure.
"""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))

from masking import mask  # noqa: E402
from scoring import load_rules, score  # noqa: E402

SAMPLES = json.loads((ROOT / "tests" / "samples.json").read_text(encoding="utf-8"))
RULES = load_rules()
MIN_DETECTION = 0.80  # share of samples where scam vs not-scam is right

failures: list[str] = []


def check(ok: bool, message: str) -> None:
    print(("  ok    " if ok else "  FAIL  ") + message)
    if not ok:
        failures.append(message)


def is_scam(verdict: str) -> bool:
    return verdict != "safe"


def report(name: str, verdicts: dict[int, str]) -> None:
    exact = sum(verdicts[s["id"]] == s["expected"] for s in SAMPLES)
    detect = sum(is_scam(verdicts[s["id"]]) == is_scam(s["expected"]) for s in SAMPLES)
    false_alarm = [s["id"] for s in SAMPLES if s["expected"] == "safe" and verdicts[s["id"]] == "dangerous"]
    print(f"\n{name}: exact {exact}/{len(SAMPLES)}, scam detection {detect}/{len(SAMPLES)}")
    for s in SAMPLES:
        got = verdicts[s["id"]]
        if got != s["expected"]:
            print(f"    #{s['id']:>2} [{s['lang']}] expected {s['expected']:<10} got {got:<10} {s['text'][:60]}")
    check(detect / len(SAMPLES) >= MIN_DETECTION, f"{name}: scam detection >= {MIN_DETECTION:.0%}")
    check(not false_alarm, f"{name}: no safe message called dangerous {false_alarm or ''}")


def test_rules_copy() -> None:
    print("rules.json copy")
    ext = ROOT / "extension" / "rules.json"
    same = ext.exists() and json.loads(ext.read_text(encoding="utf-8")) == RULES
    check(same, "extension/rules.json matches shared/rules.json (cp shared/rules.json extension/)")


def test_python_rules() -> dict[int, dict]:
    results = {s["id"]: score(s["text"], RULES) for s in SAMPLES}
    report("Python rules", {i: r["verdict"] for i, r in results.items()})
    return results


def test_js_parity(py_results: dict[int, dict]) -> None:
    print("\nJS/Python parity")
    node = shutil.which("node")
    if not node:
        print("  skip  node not found")
        return
    script = """
      const rules = require(process.argv[1]);
      const fs = require("fs");
      const cfg = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
      const samples = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
      const out = {};
      for (const s of samples) out[s.id] = { ...rules.score(s.text, cfg), masked: rules.mask(s.text) };
      process.stdout.write(JSON.stringify(out));
    """
    proc = subprocess.run(
        [node, "-e", script, str(ROOT / "extension" / "rules.js"),
         str(ROOT / "shared" / "rules.json"), str(ROOT / "tests" / "samples.json")],
        capture_output=True, text=True, encoding="utf-8",
    )
    if proc.returncode != 0:
        check(False, "node run: " + proc.stderr.strip()[:300])
        return
    js = {int(k): v for k, v in json.loads(proc.stdout).items()}
    score_diff = [i for i in py_results if js[i]["score"] != py_results[i]["score"]]
    mask_diff = [s["id"] for s in SAMPLES if js[s["id"]]["masked"] != mask(s["text"])]
    for i in score_diff:
        print(f"    #{i}: python {py_results[i]['score']} {[r['code'] for r in py_results[i]['reasons']]}"
              f" / js {js[i]['score']} {[r['code'] for r in js[i]['reasons']]}")
    check(not score_diff, f"scores identical in rules.js and scoring.py {score_diff or ''}")
    check(not mask_diff, f"masking identical in rules.js and masking.py {mask_diff or ''}")


def test_masking() -> None:
    print("\nmasking")
    cases = [
        ("Call me on +91 98765 43210", "[PHONE]", "98765"),
        ("my number is 9876543210", "[PHONE]", "9876543210"),
        ("携帯 090-1234-5678 まで", "[PHONE]", "5678"),
        ("手机 13812345678", "[PHONE]", "13812345678"),
        ("card 4111 1111 1111 1111 exp 12/27", "[CARD]", "4111"),
        ("Aadhaar 1234 5678 9012", "[ID_NUMBER]", "9012"),
        ("PAN ABCDE1234F", "[ID_NUMBER]", "ABCDE1234F"),
        ("write to ravi.k@example.com", "[EMAIL]", "ravi.k@"),
        ("Your OTP is 482913", "[CODE]", "482913"),
        ("验证码：556677", "[CODE]", "556677"),
        ("a/c 001234567890123", "[ACCOUNT]", "001234567890123"),
    ]
    for text, label, secret in cases:
        out = mask(text)
        check(label in out and secret not in out, f"{text!r} -> {out!r}")
    keep = "Go to https://sbi-kyc-update.click/yono now"
    check(mask(keep) == keep, "links are left readable")


def test_api(base: str) -> None:
    print(f"\nAPI {base}")
    try:
        with urllib.request.urlopen(base.rstrip("/") + "/health", timeout=10) as r:
            health = json.load(r)
    except OSError as e:
        check(False, f"/health reachable ({e})")
        return
    print(f"  model: {health.get('model') or 'none (rules only)'}")
    verdicts = {}
    for s in SAMPLES:
        body = json.dumps({"text": s["text"], "source": s["source"], "lang": s["lang"]}).encode()
        req = urllib.request.Request(base.rstrip("/") + "/api/scan", body, {"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                verdicts[s["id"]] = json.load(r)["verdict"]
        except OSError as e:
            check(False, f"/api/scan #{s['id']} ({e})")
            return
        print(f"    #{s['id']:>2} {verdicts[s['id']]}", flush=True)
    report("API", verdicts)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--api", help="backend base URL, e.g. http://localhost:8000")
    args = parser.parse_args()

    test_rules_copy()
    py = test_python_rules()
    test_js_parity(py)
    test_masking()
    if args.api:
        test_api(args.api)

    print(f"\n{'FAILED: ' + str(len(failures)) if failures else 'all passed'}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
