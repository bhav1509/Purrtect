# Purrtect

**They filter. We explain, stop the click, and help you recover.**

Purrtect is a friendly mascot (cat, dog or bird) for Gmail web and WhatsApp Web. It explains
risky messages in plain words, blocks risky clicks, and walks scam victims through the first
hour of recovery with verified helplines for their country.

Built for the Google Cloud AI Builder Cup 2026 · Theme: **BFSI** (Intelligent Risk, Fraud &
Financial Experiences).

- **Web checker:** https://project-1e762a2b-4a0e-4e91-981.web.app (no install needed)
- **Extension ZIP:** [latest release](https://github.com/bhav1509/Purrtect/releases/latest)

## How it works

```
Gmail / WhatsApp Web ──► Chrome extension ──(yellow/red only, masked)──► Cloud Run (FastAPI) ──► Gemini 3.5 Flash
Web checker (Firebase) ──(every scan, masked)──────────────────────────►        │                (Agent Platform)
                                                                     countries.json (verified helplines)
```

1. **Local rules** (`extension/rules.js` + `shared/rules.json`) score every link, and the full
   text from new senders, in the browser in under 5 ms. 0–29 is green, 30–59 yellow, 60+ red.
   Green never leaves the browser.
2. **Masking**: phone numbers, emails, card, account and ID numbers, and OTPs become `[PHONE]`,
   `[EMAIL]`, `[CARD]`, `[ACCOUNT]`, `[ID]` and `[OTP]` before anything is sent. The server
   masks again as a backstop.
3. **Gemini** (`gemini-3.5-flash`, fallback `gemini-3.1-flash-lite`) returns strict JSON: verdict,
   scam type, a 3–6 word headline, up to 3 red flags and advice, in the message's own language.
4. **Click blocking**: red links open a warning first (Go back / Why is this risky? / Open
   anyway). "Open anyway" shows a 10-minute "Entered anything?" banner.
5. **Recovery**: 4 tap-only questions, then a plan (Now / Today / Next few days), drafted
   police report, bank message and timeline. Phone numbers and websites come only from
   `backend/countries.json`. The server removes any other number or site from Gemini's reply.

There is no database and no login. The server logs only time, endpoint, verdict and latency.

## Repository

```
shared/rules.json        brands, keywords, risky endings, shorteners, points (source of truth)
extension/               Chrome MV3 extension (plain JS)
  background.js          right-click "Scan with Purrtect", onboarding, all backend calls
  config.js              backend URL  ← set after the first Cloud Run deploy
  rules.js               local scoring + masking (also used by web/ and the tests)
  lib/store.js           settings, known senders, corrections, 24 h link cache (hashed)
  content/               site.js (pipeline), gmail.js, whatsapp.js (selectors at the top)
  ui/                    core, verdict card, recovery panel, badge, click warning, settings, scan window
  mascots/{cat,dog,bird}/   idle, thinking, careful, stop, happy
  _locales/{en,hi,ja,zh_CN}/
backend/                 FastAPI on Cloud Run
  main.py                GET /health, POST /api/scan, POST /api/recover
  masking.py             server-side masking (identical to rules.js mask())
  contacts.py            removes numbers/sites not in countries.json
  prompts.py             system instructions + response schemas
  countries.json         IN, SG, AU, ID, PH, JP (verified Oct 11; re-check Oct 17)
web/                     web checker for Firebase Hosting (shared files copied in by scripts/sync.sh)
tests/                   30 samples (20 scams, 10 genuine) + run_tests.py
scripts/                 sync.sh, package-extension.sh
```

Shared files (rules, UI, locales, mascots) are edited in `shared/` and `extension/`, then
copied into `web/` with `./scripts/sync.sh`. The tests fail if the copies drift.

## Run locally

Backend (needs Python 3.14 and `gcloud auth application-default login` once):

```bash
cd backend
python3.14 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
export GOOGLE_CLOUD_PROJECT=project-1e762a2b-4a0e-4e91-981
uvicorn main:app --reload --port 8080
```

Extension: open `chrome://extensions`, turn on Developer mode, click **Load unpacked**, and choose `extension/`.
It calls the Cloud Run backend; to use your local one, see the note under Deploy.

Web checker:

```bash
cd web && python3 -m http.server 5500
# open http://localhost:5500/?api=http://localhost:8080
```

## Results (Oct 11, 2026, deployed backend)

30-message test set in 6 languages: scams caught **20/20**, genuine messages wrongly flagged
**0/10**, average verdict time **3.1 s**, 0 failures. Local rules alone sent all 20 scams on for
a Gemini check and kept all 10 genuine messages in the browser.

## Tests

```bash
python3 tests/run_tests.py                              # offline: rules, masking, helpline filter, sync
python3 tests/run_tests.py --api http://localhost:8080  # + 30 samples through Gemini (uses credits)
```

The `--api` run prints the deck numbers: scams caught out of 20, genuine messages wrongly
flagged out of 10, and average verdict time.

## Deploy

```bash
# Backend → Cloud Run
cd backend
gcloud run deploy purrtect-api --source . --region asia-south1 --allow-unauthenticated \
  --set-env-vars GOOGLE_CLOUD_PROJECT=project-1e762a2b-4a0e-4e91-981,GOOGLE_CLOUD_LOCATION=global

# then allow the service to call Gemini (once)
gcloud projects add-iam-policy-binding project-1e762a2b-4a0e-4e91-981 \
  --member="serviceAccount:<PROJECT_NUMBER>-compute@developer.gserviceaccount.com" \
  --role="roles/aiplatform.user"

# Web checker → Firebase Hosting (/api/** is rewritten to the Cloud Run service)
cd ../web && firebase deploy --only hosting

# Extension ZIP for judges
./scripts/package-extension.sh     # → dist/purrtect-extension.zip
```

The extension calls the deployed backend (https://purrtect-api-fzrq3bgblq-el.a.run.app), set in `extension/config.js` and
`host_permissions` in `extension/manifest.json`. For local development, point both at
`http://localhost:8080`.

## Install the extension from the ZIP

1. Download `purrtect-extension.zip` from the latest release and unzip it.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and choose the unzipped folder.
