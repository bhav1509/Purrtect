"""Server-side masking backstop. Mirrors mask() in extension/rules.js; tests/run_tests.py
checks both give identical output. re.A keeps \\b and \\w ASCII-only, matching JavaScript."""
from __future__ import annotations

import re

_MASKS: list[tuple[re.Pattern, str]] = [
    (re.compile(r"\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b", re.A), "[EMAIL]"),
    (re.compile(r"((?:otp|one-time password|code|passcode|pin|ओटीपी|कोड|認証コード|暗証番号|验证码|ஓடிபி|kode)[^\d\n]{0,20})\d{4,8}\b", re.A | re.I), r"\1[OTP]"),
    (re.compile(r"\b\d{4,8}(?=[^\d\n]{0,20}\b(?:is your|is the)\s+(?:otp|code|one-time password)\b)", re.A | re.I), "[OTP]"),
    (re.compile(r"\b(?:\d{4}[ -]){3}\d{1,7}\b|\b[3-6]\d{12,18}\b", re.A), "[CARD]"),
    (re.compile(r"\b\d{4}[ -]\d{4}[ -]\d{4}\b|\b[2-9]\d{11}\b", re.A), "[ID]"),  # Aadhaar / My Number (12 digits)
    (re.compile(r"\b[A-Z]{5}\d{4}[A-Z]\b", re.A), "[ID]"),  # India PAN
    (re.compile(r"\b[STFGM]\d{7}[A-Z]\b", re.A), "[ID]"),  # Singapore NRIC/FIN
    (re.compile(r"\b\d{16}\b", re.A), "[ID]"),  # Indonesia NIK
    (re.compile(r"\+\d{1,3}(?:[\s-]?\d){6,12}\b|\b00\d{1,3}[\s-]\d(?:[\s-]?\d){5,11}\b", re.A), "[PHONE]"),
    (re.compile(r"\b0\d{1,4}[\s-]\d{1,4}[\s-]\d{3,4}\b", re.A), "[PHONE]"),  # 090-1234-5678, 0812-3456-7890
    (re.compile(r"\b[6-9]\d{9}\b", re.A), "[PHONE]"),  # India mobile
    (re.compile(r"\b08\d{8,11}\b", re.A), "[PHONE]"),  # Indonesia mobile
    (re.compile(r"\b09\d{9}\b", re.A), "[PHONE]"),  # Philippines mobile
    (re.compile(r"\b1[3-9]\d{9}\b", re.A), "[PHONE]"),  # China mobile
    (re.compile(r"\b\d{9,18}\b", re.A), "[ACCOUNT]"),
]


def mask(text: str) -> str:
    out = text or ""
    for pattern, tag in _MASKS:
        out = pattern.sub(tag, out)
    return out
