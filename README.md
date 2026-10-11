# Purrtect

A friendly mascot (cat, dog or bird) that spots scam messages in Gmail and WhatsApp Web, warns
before you click a risky link, and walks you through recovery if you already did.
Supports English, Hindi, Japanese and Simplified Chinese.

```
shared/rules.json     brands, keywords, risky domain endings, points  (single source of truth)
extension/            Chrome MV3 extension
  background.js       right-click "Check with Purrtect", all backend calls
  rules.js            local scoring + masking (browser and Node)
  rules.json          copy of shared/rules.json
  content/            gmail.js, whatsapp.js, shared.js (scan pipeline), menu-listener.js
  ui/                 badge, verdict card, click warning, recovery panel, ui.css
  mascots/cat|dog|bird/   checking, safe, suspicious, dangerous, help (.png)
  _locales/en|hi|ja|zh_CN/messages.json
backend/              FastAPI: /api/scan, /api/recover, /health
  scoring.py          Python port of rules.js scoring
  masking.py          Python port of rules.js masking
  prompts.py          Claude prompts + JSON output schemas
  countries.json      official scam helplines and report sites
web/                  standalone web checker (Firebase Hosting)
tests/                30 sample messages + runner
```

## How a message is checked

1. **Local rules** (`rules.js`) score the message in the browser, from 0 to 100: keywords
   (urgency, OTP/password requests, prizes, threats, secrecy, job scams, "new number"
   impersonation), and link checks (risky domain endings, IP-address links, look-alike letters,
   URL shorteners, brand look-alikes, a brand named in the text but linking elsewhere). Normal
   safety advice ("never share your OTP") lowers the score. A score of 25 or more is
   *suspicious*, and 50 or more is *dangerous*.
2. If the rules flag a message, or the user clicks the badge, the text is **masked** (phones,
   emails, cards, account/ID numbers, OTPs → placeholders) and sent to `/api/scan`.
3. The backend masks again, then asks Claude (`claude-opus-5-5`, structured JSON output) for a
   verdict, scam type, red flags and advice in the user's language. The final score combines
   70% AI and 30% rules, and a rules "dangerous" result can't drop below *suspicious*. If the
   model is unreachable, the backend returns the rules-only result (`"source": "rules"`).
4. Links in flagged messages are intercepted with a "Wait! Are you sure?" warning.
5. **Recovery panel**: the user ticks what happened and picks a country. `/api/recover` returns
   ordered steps plus official helplines from `countries.json`. If the model is unavailable,
   generic offline steps are shown.

## Run it

### Backend (Python 3.10+)

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
export ANTHROPIC_API_KEY=sk-ant-...     # optional; without it you get rules-only verdicts
uvicorn main:app --reload --port 8000
```

Environment variables: `PURRTECT_MODEL` (default `claude-opus-5-5`) and `PURRTECT_CORS_ORIGINS`
(default `*`; extension origins are always allowed). Requests use the server-side refusal
fallback (`fallbacks="default"`), so if the model declines a message, the API retries it on a
fallback model instead of failing.

### Extension

```bash
cp shared/rules.json extension/rules.json    # after every rules change
```

Open `chrome://extensions`, turn on Developer mode, click **Load unpacked** and select
`extension/`. The extension calls `http://localhost:8000` by default (`apiBase` in
`chrome.storage.sync`). Before publishing, change that default in `ui/common.js` and
`background.js`, and narrow `host_permissions` in `manifest.json` to your backend's address.

Gmail and WhatsApp Web markup is undocumented. If badges stop appearing, update the
selectors at the top of `content/gmail.js` and `content/whatsapp.js`.

### Web checker

```bash
cp -R extension/mascots web/mascots          # already done once; repeat if art changes
cd web && python3 -m http.server 5500        # open http://localhost:5500/?api=http://localhost:8000
```

Deploy: run the backend on Cloud Run as `purrtect-api` in `asia-south1` (or change
`web/firebase.json`), then `firebase deploy --only hosting` from `web/`. Firebase sends
`/api/**` to the Cloud Run service, so the page and the API share one origin.

## Tests

```bash
python3 tests/run_tests.py                          # offline: rules, JS/Python parity, masking
python3 tests/run_tests.py --api http://localhost:8000   # also run all 30 samples through the API
```

The runner needs only the Python standard library. It also needs Node to check that
`rules.js` and `scoring.py`/`masking.py` give identical results; without Node, that check
is skipped. Pass criteria:
- At least 80% of samples are correctly sorted into scam vs. not-scam.
- No safe sample is called dangerous.
- JS and Python give identical scores and masking.
- `extension/rules.json` matches `shared/rules.json`.

Currently the rules alone get 29/30 exact verdicts and 30/30 scam detection. Sample #2 (lottery
plus a short link) scores *suspicious* rather than *dangerous* without the AI check.

## Before release

- **Check `backend/countries.json` against official sources.** Helpline numbers and sites
  change. For example, the UK's Action Fraud service is being rebranded.
- Replace the placeholder mascot art in `extension/mascots/` (256×256 PNG, same file names).
- Have native speakers review the Hindi, Japanese and Chinese strings in `extension/_locales/`,
  and the non-English keywords in `shared/rules.json`.
