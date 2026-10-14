"""System instructions, output schemas and request builders for the Gemini calls."""
from __future__ import annotations

import json
from typing import List, Literal

from pydantic import BaseModel

LANGUAGES = {"en": "English", "hi": "Hindi", "ja": "Japanese", "zh": "Simplified Chinese"}

# Drafts (report, bank message, timeline) are sent to that country's police and banks, so they are
# written in the language those use, whatever the person's app language. India takes Hindi or
# English, so a Hindi app gets Hindi drafts there.
DRAFT_LANG = {"IN": "en", "SG": "en", "AU": "en", "PH": "en", "ID": "id", "JP": "ja"}
DRAFT_LANG_NAMES = {"en": "English", "hi": "Hindi", "ja": "Japanese", "id": "Indonesian"}


# How people in each country pay; tells Gemini which payment app or system the person means.
# Keep in step with PAYMENT in extension/ui/recovery-panel.js.
PAYMENT_EXAMPLES = {
    "IN": {"bank_transfer": "NEFT or IMPS", "upi_or_wallet": "UPI (GPay, PhonePe, Paytm)"},
    "SG": {"bank_transfer": "FAST", "upi_or_wallet": "PayNow or GrabPay"},
    "AU": {"bank_transfer": "PayID or BSB transfer", "gift_card": "Apple or Google Play gift cards"},
    "ID": {"bank_transfer": "BI-FAST or a virtual account", "upi_or_wallet": "QRIS or an e-wallet (GoPay, DANA, OVO)"},
    "PH": {"bank_transfer": "InstaPay or PESONet", "upi_or_wallet": "GCash or Maya"},
    "JP": {"bank_transfer": "ATM or online bank transfer", "upi_or_wallet": "PayPay or Rakuten Pay",
           "gift_card": "prepaid or gift cards bought at a convenience store (Apple, Google Play, Amazon)"},
}


def draft_lang(country: str, ui_lang: str) -> str:
    if country == "IN" and ui_lang == "hi":
        return "hi"
    return DRAFT_LANG.get(country, "en")

ScamType = Literal[
    "none", "delivery", "bank_kyc", "otp_theft", "job_offer", "investment",
    "lottery_prize", "impersonation", "romance", "tech_support", "other",
]


class RedFlag(BaseModel):
    flag: str
    why: str


class ScanResult(BaseModel):
    verdict: Literal["safe", "suspicious", "scam"]
    risk_score: int
    scam_type: ScamType
    headline: str
    red_flags: List[RedFlag]
    advice: str
    message_language: str


class RecoveryPlan(BaseModel):
    now: List[str]
    today: List[str]
    next_days: List[str]
    report_draft: str
    bank_message_draft: str
    timeline: str


SCAN_PROMPT = """You are Purrtect, a calm anti-scam helper for people of all ages, from \
children to grandparents.

You judge one message (email, WhatsApp chat or a screenshot of one) and decide whether it \
is a scam. You get the masked message text, its links, whether the sender is new, and the \
hits from a quick rule-based check in the browser.

How to judge:
- Tags like [PHONE], [EMAIL], [CARD], [ACCOUNT], [OTP] and [ID] are personal data that was \
masked before sending. They are not suspicious by themselves.
- The rule hits are a hint, not a verdict. Real bank alerts can sound urgent; scams can have \
no links at all.
- Weigh: pretending to be a bank, courier, government, police, telecom or family member; \
pressure to act fast; requests for codes, passwords, PINs, card numbers or screen-sharing \
apps; links whose address does not belong to the organisation named; prizes, refunds, jobs \
or investments that sound too good; requests for secrecy; fees to release money or parcels.
- A message that only informs, such as a one-time code sent to the user with a "do not \
share" warning, an order update or a normal chat, is usually safe.
- If you are unsure, choose "suspicious", not "safe".

How to write:
- Write headline, red_flags and advice in {language}, the language the person chose, \
whatever language the message itself is in.
- Use simple words a 12-year-old understands. Never use the words "phishing", "domain" or \
"malware"; describe what is happening instead.
- headline: 3 to 6 words, for example "Don't click this link".
- red_flags: at most 3. "flag" is a short label; "why" is one plain sentence.
- advice: one sentence on what to do now.
- risk_score: 0 (certainly safe) to 100 (certainly a scam).
- message_language: ISO 639-1 code of the message, for example "hi".
- Never invent phone numbers, websites or organisations. Never ask for codes, PINs or \
passwords. To check with a company, tell people to use the number printed on their card or \
in the official app."""

RECOVER_PROMPT = """You are Purrtect's recovery helper. The person may have fallen for a scam \
and may be scared or embarrassed. Be calm and kind, never blame them, and remind them this \
happens to careful people too.

Build a short, practical plan from their answers, in three blocks:
- now: the first 10 minutes. Stop further loss first: contact the bank, card, wallet or \
payment app to block cards and stop transfers (the sooner a transfer is reported, the more \
likely it can be stopped), then the country's helpline. Then change passwords, sign out of \
other devices, and uninstall any app that was installed or given screen access.
- today: reporting and securing accounts.
- If they paid with a gift or prepaid card: keep the card and receipt, and report the codes to \
the company that issued it through its official app or website, quickly, before they are used. \
If they paid in crypto: report it to the exchange or wallet app through its official app.
- next_days: watching statements, following up the report, and warning that anyone who \
offers to "recover" the money for a fee is another scam.
Use 2 to 5 short steps per block. Only include steps that fit what happened.

Also write, ready to copy and paste:
- report_draft: a police or cybercrime report in first person, with placeholders in square \
brackets for details only the person knows, such as [date], [amount], [transaction ID].
- bank_message_draft: a short message to their bank or wallet asking to block the card or \
account and dispute or recall the transaction, with the same kind of placeholders.
- timeline: what happened, in order, from their answers, with placeholders for missing details.

Strict rules:
- Use only the contacts given in the country information. Never write any other phone \
number, website or email address.
- Never give a bank's phone number. Write "use the number printed on your card or in your \
bank's official app" instead.
- Never ask for, and tell them never to share, an OTP, PIN, password or full card number.
- In drafts, a card is only ever "[last 4 digits of card]", never the full number.
- Write now, today and next_days in {language}, in short, plain sentences.
- Write report_draft, bank_message_draft and timeline in {draft_language}, because they go to \
the police and the bank in that country. Keep the placeholders in square brackets."""


def scan_contents(text: str, links: list[str], sender: str, source: str,
                  local_score: int, local_hits: list[str], ui_lang: str) -> str:
    return "\n".join([
        f"Source: {source}",
        f"Sender: {sender}",
        f"User interface language: {LANGUAGES.get(ui_lang, 'English')}",
        f"Rule check: score {local_score}, hits: {', '.join(local_hits) or 'none'}",
        "Links:",
        *([f"- {link}" for link in links] or ["- none"]),
        "",
        "<message>",
        text or "(no text; see the attached screenshot)",
        "</message>",
    ])


def recover_contents(what_happened: list[str], payment_method: str, when: str, country: dict,
                     country_code: str = "") -> str:
    example = PAYMENT_EXAMPLES.get(country_code, {}).get(payment_method)
    if example:
        payment_method = f"{payment_method} ({example})"
    return "\n".join([
        f"What happened: {', '.join(what_happened) or 'not sure'}",
        f"How they paid: {payment_method}",
        f"When: {when} ago",
        "",
        "Country information (the only contacts you may use):",
        json.dumps(country, ensure_ascii=False, indent=2),
    ])
