"""Purrtect API.

  GET  /health        liveness + whether the model is configured
  POST /api/scan      rule pre-check + Claude verdict for one message
  POST /api/recover   step-by-step help after someone clicked, paid or shared a code

Run:  uvicorn main:app --reload --port 8000   (from backend/)
"""
from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import List, Literal, Optional

import anthropic
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

import prompts
from masking import mask
from scoring import load_rules, score

log = logging.getLogger("purrtect")

MODEL = os.environ.get("PURRTECT_MODEL", "claude-opus-5-5")
MAX_CHARS = 8000

RULES = load_rules()
COUNTRIES = json.loads((Path(__file__).parent / "countries.json").read_text(encoding="utf-8"))

# Zero-arg client resolves ANTHROPIC_API_KEY or an `ant auth login` profile.
try:
    client: Optional[anthropic.AsyncAnthropic] = anthropic.AsyncAnthropic()
except Exception:  # no credentials: serve rule-only verdicts
    client = None

app = FastAPI(title="Purrtect API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get("PURRTECT_CORS_ORIGINS", "*").split(","),
    allow_origin_regex=r"chrome-extension://.*",
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)

Lang = Literal["en", "hi", "ja", "zh_CN"]


class ScanRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=50_000)
    source: Literal["gmail", "whatsapp", "selection", "web"] = "web"
    lang: Lang = "en"


class RecoverRequest(BaseModel):
    what_happened: List[
        Literal["clicked_link", "entered_password", "shared_otp", "paid_money", "installed_app", "shared_id"]
    ] = []
    details: str = Field("", max_length=4000)
    country: str = "IN"
    lang: Lang = "en"


async def ask_claude(system: str, user: str, schema: dict, effort: str) -> Optional[dict]:
    """One structured-output call. Returns None when the model is unavailable or declines,
    so callers can fall back to rule-only results."""
    if client is None:
        return None
    try:
        response = await client.beta.messages.create(
            model=MODEL,
            max_tokens=8000,
            system=system,
            messages=[{"role": "user", "content": user}],
            output_config={"effort": effort, "format": {"type": "json_schema", "schema": schema}},
            # On a safety decline, the API retries on a fallback model within the same call.
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
        )
    except anthropic.APIConnectionError as e:
        log.warning("Claude unreachable: %s", e)
        return None
    except anthropic.RateLimitError:
        log.warning("Claude rate limited")
        return None
    except anthropic.APIStatusError as e:
        log.error("Claude error %s: %s", e.status_code, e.message)
        return None
    except (anthropic.AnthropicError, TypeError) as e:  # TypeError: no credentials could be resolved
        log.error("Claude unavailable: %s", e)
        return None

    if response.stop_reason != "end_turn":
        log.warning("Claude stopped with %s", response.stop_reason)
        return None
    text = next((b.text for b in response.content if b.type == "text"), None)
    return json.loads(text) if text else None


def combine(rule: dict, ai: Optional[dict]) -> dict:
    """The model's judgment leads; rules can raise but not erase a strong signal."""
    if ai is None:
        return {"verdict": rule["verdict"], "score": rule["score"], "source": "rules"}
    final = round(0.7 * ai["score"] + 0.3 * rule["score"])
    if rule["verdict"] == "dangerous":
        final = max(final, RULES["thresholds"]["suspicious"])
    t = RULES["thresholds"]
    verdict = "dangerous" if final >= t["dangerous"] else "suspicious" if final >= t["suspicious"] else "safe"
    return {"verdict": verdict, "score": final, "source": "rules+ai"}


@app.get("/health")
async def health():
    return {"ok": True, "model": MODEL if client else None, "rules_version": RULES["version"]}


@app.post("/api/scan")
async def scan(req: ScanRequest):
    text = req.text[:MAX_CHARS]
    rule = score(text, RULES)  # links and brands are scored before masking hides anything
    masked = mask(text)
    ai = await ask_claude(
        prompts.SCAN_SYSTEM.format(language=prompts.language_name(req.lang)),
        prompts.scan_user_message(masked, req.source, rule),
        prompts.SCAN_SCHEMA,
        effort="low",
    )
    return {
        **combine(rule, ai),
        "rules": rule,
        "scam_type": ai["scam_type"] if ai else None,
        "summary": ai["summary"] if ai else None,
        "red_flags": ai["red_flags"] if ai else [],
        "what_to_do": ai["what_to_do"] if ai else [],
    }


@app.post("/api/recover")
async def recover(req: RecoverRequest):
    country = COUNTRIES.get(req.country.upper())
    ai = await ask_claude(
        prompts.RECOVER_SYSTEM.format(language=prompts.language_name(req.lang)),
        prompts.recover_user_message(req.what_happened, mask(req.details), country),
        prompts.RECOVER_SCHEMA,
        effort="medium",
    )
    return {
        "country": country,
        "reassurance": ai["reassurance"] if ai else None,
        "steps": ai["steps"] if ai else [],
        "source": "ai" if ai else "static",
    }
