"""Purrtect API: masks personal data, asks Gemini, returns verdicts and recovery plans.
Stores nothing; logs only time, endpoint, verdict and latency.

  GET  /health
  POST /api/scan
  POST /api/recover
"""
from __future__ import annotations

import asyncio
import base64
import binascii
import json
import logging
import os
import time
from collections import defaultdict, deque
from typing import List, Literal, Optional

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from google import genai
from google.genai import errors, types
from pydantic import BaseModel, Field

import prompts
from contacts import COUNTRIES, strip_unverified
from masking import mask

PROJECT = os.environ.get("GOOGLE_CLOUD_PROJECT", "")
LOCATION = os.environ.get("GOOGLE_CLOUD_LOCATION", "global")
MODELS = [os.environ.get("PURRTECT_MODEL", "gemini-3.5-flash"),
          os.environ.get("PURRTECT_FALLBACK_MODEL", "gemini-3.1-flash-lite")]
AI_TIMEOUT_S = 8.0  # scans: the client shows "Basic check only" after this
RECOVER_TIMEOUT_S = 20.0  # recovery plans are long (steps + 3 drafts); the person is waiting on this screen
# Start the fallback model if the primary hasn't answered by then. Healthy gemini-3.5-flash
# answers take ~1.5-3 s; stalled ones never return, so waiting longer only adds latency.
HEDGE_AFTER_S = float(os.environ.get("PURRTECT_HEDGE_AFTER_S", "2.0"))
RATE_LIMIT_PER_MIN = int(os.environ.get("PURRTECT_RATE_LIMIT", "30"))
MAX_IMAGE_BYTES = 4 * 1024 * 1024

logging.basicConfig(level=logging.INFO, format="%(message)s")
log = logging.getLogger("purrtect")
logging.getLogger("httpx").setLevel(logging.WARNING)  # request lines only; keep logs minimal

client: Optional[genai.Client] = None
if PROJECT:
    # Gemini Enterprise Agent Platform (formerly Vertex AI). Auth: Application Default
    # Credentials locally, the Cloud Run service account when deployed. No API key.
    client = genai.Client(enterprise=True, project=PROJECT, location=LOCATION,
                          http_options=types.HttpOptions(timeout=int(AI_TIMEOUT_S * 1000)))

ORIGINS = [o for o in os.environ.get("PURRTECT_ALLOWED_ORIGINS", "").split(",") if o]
if PROJECT:
    ORIGINS += [f"https://{PROJECT}.web.app", f"https://{PROJECT}.firebaseapp.com"]
ORIGINS += ["http://localhost:5000", "http://localhost:5500", "http://127.0.0.1:5500"]

app = FastAPI(title="Purrtect API")
# The extension calls through its host permission, and Firebase Hosting rewrites /api to
# this service, so CORS only matters for the web checker on its own origin and local dev.
app.add_middleware(CORSMiddleware, allow_origins=ORIGINS, allow_methods=["GET", "POST"],
                   allow_headers=["Content-Type"])

Country = Literal["IN", "SG", "AU", "ID", "PH", "JP"]


class ScanRequest(BaseModel):
    text: str = Field("", max_length=20_000)
    links: List[str] = Field(default_factory=list, max_length=50)
    image_base64: Optional[str] = Field(None, max_length=6_000_000)
    sender: Literal["new", "known"] = "new"
    source: Literal["gmail", "whatsapp", "web"] = "web"
    local_score: int = Field(0, ge=0, le=100)
    local_hits: List[str] = Field(default_factory=list, max_length=20)
    ui_lang: Literal["en", "hi", "ja", "zh"] = "en"
    country: Country = "IN"


class RecoverRequest(BaseModel):
    what_happened: List[Literal["opened_link", "typed_password", "shared_otp", "paid", "installed_app", "shared_id"]] = []
    payment_method: Literal["card", "bank_transfer", "upi_or_wallet", "none"] = "none"
    when: Literal["minutes", "hours", "days"] = "minutes"
    country: Country = "IN"
    lang: Literal["en", "hi", "ja", "zh"] = "en"


class AIUnavailable(Exception):
    pass


# --- simple per-IP rate limit (per instance) ---------------------------------------------
_hits: dict[str, deque] = defaultdict(deque)


@app.middleware("http")
async def rate_limit(request: Request, call_next):
    if request.url.path.startswith("/api/"):
        forwarded = request.headers.get("x-forwarded-for", "")
        ip = forwarded.split(",")[0].strip() or (request.client.host if request.client else "?")
        now = time.monotonic()
        q = _hits[ip]
        while q and now - q[0] > 60:
            q.popleft()
        if len(q) >= RATE_LIMIT_PER_MIN:
            return JSONResponse({"error": "rate_limited"}, status_code=429)
        q.append(now)
    return await call_next(request)


def log_event(endpoint: str, verdict: str, started: float, model: str = "") -> None:
    log.info(json.dumps({"ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "endpoint": endpoint,
                         "verdict": verdict, "model": model,
                         "latency_ms": round((time.monotonic() - started) * 1000)}))


async def _generate(model: str, contents: list, config: types.GenerateContentConfig,
                    schema: type[BaseModel]) -> BaseModel:
    resp = await client.aio.models.generate_content(model=model, contents=contents, config=config)
    if isinstance(resp.parsed, schema):
        return resp.parsed
    if resp.text:
        return schema.model_validate_json(resp.text)  # raises ValueError if unparsable
    raise ValueError("empty response")


async def ask_gemini(system: str, contents: list, schema: type[BaseModel],
                     budget_s: float = AI_TIMEOUT_S) -> tuple[BaseModel, str]:
    """Structured call within one time budget. The primary model usually answers in ~2 s but
    sometimes stalls, so if it hasn't answered after HEDGE_AFTER_S (or fails), the fallback model
    starts too and the first valid answer wins."""
    if client is None:
        raise AIUnavailable("GOOGLE_CLOUD_PROJECT is not set")
    config = types.GenerateContentConfig(
        system_instruction=system,
        response_mime_type="application/json",
        response_schema=schema,
        temperature=0.2,
        thinking_config=types.ThinkingConfig(thinking_level="LOW"),
        http_options=types.HttpOptions(timeout=int(budget_s * 1000)),
    )
    loop = asyncio.get_running_loop()
    start = loop.time()
    deadline = start + budget_s
    pending = {asyncio.create_task(_generate(MODELS[0], contents, config, schema)): MODELS[0]}
    hedged = False
    try:
        while pending:
            wait_until = deadline if hedged else min(deadline, start + HEDGE_AFTER_S)
            done, _ = await asyncio.wait(pending, timeout=max(0.0, wait_until - loop.time()),
                                         return_when=asyncio.FIRST_COMPLETED)
            for task in done:
                model = pending.pop(task)
                try:
                    return task.result(), model
                except errors.APIError as e:
                    log.warning(json.dumps({"event": "gemini_error", "model": model, "code": e.code, "status": e.status}))
                except Exception as e:  # unparsable reply, network error
                    log.warning(json.dumps({"event": "gemini_failed", "model": model, "error": type(e).__name__}))
            if loop.time() >= deadline:
                break
            if not hedged and (not pending or loop.time() >= start + HEDGE_AFTER_S):
                hedged = True
                pending[asyncio.create_task(_generate(MODELS[1], contents, config, schema))] = MODELS[1]
    finally:
        for task in pending:
            task.cancel()
    raise AIUnavailable("model unavailable or too slow")


def decode_image(b64: str) -> types.Part:
    if "," in b64[:100]:  # data:image/png;base64,....
        b64 = b64.split(",", 1)[1]
    try:
        data = base64.b64decode(b64, validate=True)
    except (binascii.Error, ValueError):
        raise HTTPException(400, "image_base64 is not valid base64")
    if len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(413, "image is larger than 4 MB")
    if data.startswith(b"\x89PNG"):
        mime = "image/png"
    elif data.startswith(b"\xff\xd8"):
        mime = "image/jpeg"
    elif data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        mime = "image/webp"
    else:
        raise HTTPException(415, "use a PNG, JPEG or WebP screenshot")
    return types.Part.from_bytes(data=data, mime_type=mime)


@app.get("/health")
async def health():
    return {"ok": True, "model": MODELS[0], "ai_configured": client is not None}


@app.post("/api/scan")
async def scan(req: ScanRequest):
    started = time.monotonic()
    if not req.text.strip() and not req.links and not req.image_base64:
        raise HTTPException(400, "send text, links or an image")
    contents: list = [prompts.scan_contents(
        mask(req.text), [mask(link) for link in req.links], req.sender, req.source,
        req.local_score, req.local_hits, req.ui_lang)]
    if req.image_base64:
        contents.append(decode_image(req.image_base64))  # processed in memory, never stored
    try:
        system = prompts.SCAN_PROMPT.format(language=prompts.LANGUAGES[req.ui_lang])
        result, model = await ask_gemini(system, contents, prompts.ScanResult)
    except AIUnavailable:
        log_event("scan", "ai_unavailable", started)
        return JSONResponse({"error": "ai_unavailable"}, status_code=503)

    row = COUNTRIES[req.country]
    out = result.model_dump()
    out["risk_score"] = max(0, min(100, out["risk_score"]))
    out["red_flags"] = [{"flag": strip_unverified(f["flag"], row), "why": strip_unverified(f["why"], row)}
                        for f in out["red_flags"][:3]]
    out["headline"] = strip_unverified(out["headline"], row)
    out["advice"] = strip_unverified(out["advice"], row)
    log_event("scan", out["verdict"], started, model)
    return out


@app.post("/api/recover")
async def recover(req: RecoverRequest):
    started = time.monotonic()
    row = COUNTRIES[req.country]
    contents = [prompts.recover_contents(req.what_happened, req.payment_method, req.when, row)]
    system = prompts.RECOVER_PROMPT.format(language=prompts.LANGUAGES[req.lang])
    try:
        plan, model = await ask_gemini(system, contents, prompts.RecoveryPlan, RECOVER_TIMEOUT_S)
    except AIUnavailable:
        log_event("recover", "ai_unavailable", started)
        # The client shows its built-in basic steps next to these verified contacts.
        return JSONResponse({"error": "ai_unavailable", "country": req.country, "contacts": row}, status_code=503)

    out = plan.model_dump()
    for key in ("now", "today", "next_days"):
        out[key] = [strip_unverified(step, row) for step in out[key]]
    for key in ("report_draft", "bank_message_draft", "timeline"):
        out[key] = strip_unverified(out[key], row)
    out["country"] = req.country
    out["contacts"] = row  # copied verbatim from countries.json
    log_event("recover", "plan", started, model)
    return out
