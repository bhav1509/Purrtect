"""Strip personal data from message text before it is logged or sent to the model.

Mirrors mask() in extension/rules.js. The extension masks first; this is the
second pass for anything that reaches the API unmasked (e.g. the web checker).
re.A keeps \b and \w ASCII-only, matching JavaScript regex semantics.
"""
from __future__ import annotations

import re

_MASKS = [
    (re.compile(r"\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b", re.A), "[EMAIL]"),
    (re.compile(r"\b(?:\d{4}[ -]){3}\d{1,7}\b|\b[3-6]\d{12,18}\b", re.A), "[CARD]"),
    (re.compile(r"\b\d{4}\s?\d{4}\s?\d{4}\b", re.A), "[ID_NUMBER]"),  # Aadhaar-style 12 digits
    (re.compile(r"\b[A-Z]{5}\d{4}[A-Z]\b", re.A), "[ID_NUMBER]"),  # PAN
    (re.compile(r"\+\d{1,3}(?:[\s-]?\d){6,12}\b|\b00\d{1,3}[\s-]\d(?:[\s-]?\d){5,11}\b", re.A), "[PHONE]"),
    (re.compile(r"\b0\d{1,4}[\s-]\d{1,4}[\s-]\d{3,4}\b", re.A), "[PHONE]"),  # JP/UK style 090-1234-5678
    (re.compile(r"\b[6-9]\d{9}\b", re.A), "[PHONE]"),  # IN mobile
    (re.compile(r"\b1[3-9]\d{9}\b", re.A), "[PHONE]"),  # CN mobile
    (re.compile(r"\b\d{9,18}\b", re.A), "[ACCOUNT]"),
    (
        re.compile(r"((?:otp|code|pin|passcode|ओटीपी|验证码|認証コード|暗証番号)[^\d\n]{0,20})\d{4,8}", re.I | re.A),
        r"\1[CODE]",
    ),
]


def mask(text: str) -> str:
    out = text or ""
    for pattern, label in _MASKS:
        out = pattern.sub(label, out)
    return out
