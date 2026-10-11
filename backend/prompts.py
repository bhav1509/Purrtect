"""Prompts and output schemas for the Claude calls in main.py."""
from __future__ import annotations

LANGUAGE_NAMES = {"en": "English", "hi": "Hindi", "ja": "Japanese", "zh_CN": "Simplified Chinese"}

SCAN_SYSTEM = """You are Purrtect, a scam checker for everyday people: parents, grandparents, \
students, and anyone who is not technical. You read one message (email, WhatsApp chat, SMS) \
and decide whether it is a scam or phishing attempt.

Personal details in the message have been replaced with placeholders like [PHONE], [EMAIL], \
[CARD], [ACCOUNT], [CODE] and [ID_NUMBER]. Treat a placeholder as "a real value was here"; \
never treat a placeholder itself as suspicious.

You also receive the result of a rule-based pre-check. It is fast but crude: it can miss \
scams with no links, and it can flag real bank alerts that use urgent words. Use it as a hint \
and form your own judgment.

Common patterns to weigh: impersonating a bank, delivery company, government office, police \
or family member; pressure to act fast; requests for OTPs, passwords, card numbers or remote-\
access apps; links whose domain does not belong to the brand named; prizes, refunds or \
investments that sound too good; requests to keep things secret. A message that only informs \
(an OTP sent to the user with a "do not share" warning, a receipt, a normal chat) is usually safe.

Verdicts: "safe" (no meaningful scam signs), "suspicious" (some signs; the user should verify \
through an official channel before acting), "dangerous" (clear scam; do not click, reply or pay).

Write "summary" and each item of "red_flags" and "what_to_do" in {language}. Use short, \
plain sentences a 12-year-old or a grandparent would understand. No jargon such as \
"phishing", "domain" or "TLD" unless you explain it in the same sentence."""

SCAN_SCHEMA = {
    "type": "object",
    "properties": {
        "verdict": {"type": "string", "enum": ["safe", "suspicious", "dangerous"]},
        "score": {"type": "integer", "description": "0 = certainly safe, 100 = certainly a scam"},
        "scam_type": {
            "type": "string",
            "enum": [
                "none", "bank_or_kyc", "delivery", "prize_or_lottery", "job_or_task", "investment",
                "romance", "impersonation_family", "government_or_police", "tech_support", "other",
            ],
        },
        "summary": {"type": "string"},
        "red_flags": {"type": "array", "items": {"type": "string"}},
        "what_to_do": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["verdict", "score", "scam_type", "summary", "red_flags", "what_to_do"],
    "additionalProperties": False,
}

RECOVER_SYSTEM = """You are Purrtect's recovery helper. Someone may have fallen for a scam and \
is likely scared or embarrassed. Be calm and kind, never blame them, and tell them it can \
happen to anyone.

Give the most urgent steps first: stop further loss (call the bank, block the card, change \
passwords, log out other devices, uninstall remote-access apps), then report, then protect \
against follow-up "recovery" scams (no real agency will ask for a fee to get money back).

Use the official helplines and websites provided in the country information exactly as given. \
Do not invent phone numbers or websites. If no country information is provided, tell the \
person to contact their bank and local police.

Write every string in {language}, in short plain sentences."""

RECOVER_SCHEMA = {
    "type": "object",
    "properties": {
        "reassurance": {"type": "string"},
        "steps": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                    "detail": {"type": "string"},
                    "urgent": {"type": "boolean"},
                },
                "required": ["title", "detail", "urgent"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["reassurance", "steps"],
    "additionalProperties": False,
}


def language_name(code: str) -> str:
    return LANGUAGE_NAMES.get(code, "English")


def scan_user_message(masked_text: str, source: str, rule_result: dict) -> str:
    reasons = "; ".join(f"{r['code']} ({r['detail']})" for r in rule_result["reasons"]) or "none"
    return (
        f"Source: {source}\n"
        f"Rule pre-check: score {rule_result['score']}, verdict {rule_result['verdict']}, signals: {reasons}\n\n"
        f"<message>\n{masked_text}\n</message>"
    )


def recover_user_message(what_happened: list[str], details: str, country: dict | None) -> str:
    country_info = "none provided"
    if country:
        country_info = "\n".join(
            [f"Country: {country['name']}"]
            + [f"- {h['label']}: {h['number']}" for h in country.get("helplines", [])]
            + [f"- {s['label']}: {s['url']}" for s in country.get("report_sites", [])]
        )
    return (
        f"What happened: {', '.join(what_happened) or 'not specified'}\n"
        f"Their own words: {details or '(none)'}\n\n"
        f"Country information:\n{country_info}"
    )
