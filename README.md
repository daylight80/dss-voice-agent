# Amber — Driving School Solutions voice receptionist

TypeScript service for Driving School Solutions. **Amber** answers **+442081941993** via xAI Speech-to-Speech over SIP: she greets callers, answers FAQs, qualifies leads, books callbacks, takes messages, and can transfer to a member of the team. **Mirra** is the website chat assistant on the same service. She quotes the same facts, and writes to the same lead list.

Tagline: **Turn local searches into driving students.**

This is also the foundation for the **AI Voice Receptionist** product sold to ADIs.

## Architecture

1. Caller dials the Twilio UK number.
2. Twilio Elastic SIP Trunk originates to `sip:+442081941993@sip.voice.x.ai;transport=tls`.
3. xAI POSTs a signed `realtime.call.incoming` event to `POST /webhooks/xai/incoming`.
4. This service verifies the signature, opens `wss://api.x.ai/v1/realtime?call_id=…`, sends `session.update` (Amber prompt + tools) and `response.create` so she greets first.
5. Tool calls (`save_lead`, `book_callback`, `leave_message`, `transfer_to_grant`) append JSONL under `DATA_DIR` and email Grant when SMTP or `EMAIL_WEBHOOK_URL` is set. Those immediate emails stay, because they are the thing to act on (a new lead, a callback, a message).
6. When the realtime socket closes — caller hung up, transfer completed, or the leg dropped — Amber emails **one** summary of that call to `NOTIFY_TO_EMAIL`, including silent hangups. The record is appended to `$DATA_DIR/calls.jsonl`. A short summary is written with the xAI API; if that fails, the transcript is still emailed. On startup, and once a day after that, lines older than `DATA_RETENTION_DAYS` (default 30) are deleted. A caller's name is kept until that many days after the last call from their number, in `$DATA_DIR/caller-names.json`, without the transcript.
7. If the SIP From header has a real number, Amber is told to confirm it (last three digits) instead of asking. A withheld or unknown number changes nothing. When a previous lead or call summary stored a name for that number, she is told to greet them by name and check it is them. The lookup does not hold up the greeting.

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/health` | Render health check |
| `POST` | `/webhooks/xai/incoming` | xAI `realtime.call.incoming` webhook |
| `GET` | `/mirra/widget.js` | Chat bubble script for the WordPress site |
| `POST` | `/mirra/chat` | One Mirra turn. Requires an allowed `Origin` |
| `GET` | `/mirra/leads` | Lead read for a follow-up assistant. Requires `LEADS_READ_TOKEN` |
| `GET` | `/adi/widget.js` | ADI chat bubble for Formula Jon Driving School |
| `POST` | `/adi/chat` | One ADI turn. Requires an allowed Formula Jon `Origin` |
| `GET` | `/adi/leads` | ADI enquiries only. Same `LEADS_READ_TOKEN` |
| `GET` | `/adi/preview` | Local-style preview page. Not part of Jon's site |

## Mirra — website chat

Mirra is a text assistant for [drivingschoolsolutions.co.uk](https://drivingschoolsolutions.co.uk). British English, no emoji. She answers from the same fact list as Amber (`src/agency-facts.ts`), captures an enquiry, books a callback, takes a message, and offers the free Google Business Profile audit (the free Local SEO Audit Amber already describes). She does not take card details, and she does not claim to be human.

Each saved enquiry is one JSON line in `$DATA_DIR/leads.jsonl`, the file Amber already uses, with `source` set to `website_chat` and `type` one of `lead`, `callback`, `message`, or `gbp_audit` (a GBP audit request). The same email path runs: `EMAIL_WEBHOOK_URL`, or SMTP when `SMTP_HOST` and `NOTIFY_TO_EMAIL` are set. If neither is set, the lead is still saved and the server logs that email is not configured. No extra email variables are required for Mirra.

Visitor-facing wording follows Amber and says "a member of the team". The email subject starts with `Mirra:` so it is distinct from an `Amber:` phone lead.

### WordPress

The bubble is one script tag. It loads on every page, uses a shadow root so it does not pick up Elementor styles, and posts back to this service.

1. In WordPress admin, open **WPCode → Header & Footer** and choose the site-wide footer. If you use Elementor instead: **Site Settings → Custom Code → Add new**, location **`</body>` end**, display **entire site**.
2. Paste this snippet and save:

```html
<script src="https://dss-voice-agent.onrender.com/mirra/widget.js" defer></script>
```

3. Clear any page cache (Elementor, the caching plugin, or Cloudflare).
4. Open the site in a private window. Mirra's round face sits at the bottom left, clear of the reCAPTCHA badge. The opening line is: "Hi, I'm Mirra. How can I help you?"

The chat API only accepts pages whose `Origin` is `https://drivingschoolsolutions.co.uk` or `https://www.drivingschoolsolutions.co.uk`, plus localhost for testing. Set `MIRRA_ALLOWED_ORIGINS` to replace that site list (include every origin you still want, comma-separated). Set `MIRRA_ALLOW_LOCALHOST=false` to refuse localhost. A request with no `Origin`, or from another site, is rejected.

### Follow-up

Another assistant can read the same list. Amber's older lines have no `source` field; those count as `phone`.

```bash
curl -s \
  -H "Authorization: Bearer $LEADS_READ_TOKEN" \
  "https://dss-voice-agent.onrender.com/mirra/leads?source=website_chat"
```

Query parameters: `source` (`phone` or `website_chat`), `type` (`lead`, `callback`, `message`, `gbp_audit`), `since` (ISO time, inclusive), and `limit` (default 50, maximum 200). Newest first. The token is only the `Authorization: Bearer` header. If `LEADS_READ_TOKEN` is unset, the endpoint stays closed and returns 503.

The on-disk copy is `$DATA_DIR/leads.jsonl` (`/data/leads.jsonl` on Render). A website line looks like:

```json
{"type":"callback","source":"website_chat","callId":"chat:<conversation>","conversationId":"<conversation>","name":"Sam Taylor","phone":"07900 111222","preferred_time":"Tomorrow morning","receivedAt":"2026-11-09T10:15:00.000Z"}
```

`DATA_RETENTION_DAYS` (default 30) applies to these lines as well.

### Try Mirra after deploy

`XAI_API_KEY` is the key Mirra uses. The text model defaults to `grok-4.7` with reasoning effort `low` (`XAI_CHAT_MODEL`, `MIRRA_REASONING_EFFORT`).

```bash
curl -s https://dss-voice-agent.onrender.com/health
curl -s -D- \
  -H "Origin: https://drivingschoolsolutions.co.uk" \
  -H "Content-Type: application/json" \
  -d '{"message":"How much is the five-page website?"}' \
  https://dss-voice-agent.onrender.com/mirra/chat
```

The reply should quote £299.99 and no other price. Then add the WordPress snippet and send a test callback from the bubble. If email is configured, Grant receives `Mirra: callback request from <name>`. Either way the lead is in:

```bash
curl -s \
  -H "Authorization: Bearer $LEADS_READ_TOKEN" \
  "https://dss-voice-agent.onrender.com/mirra/leads?source=website_chat&type=callback"
```

Locally, the same calls work against `http://127.0.0.1:10000` with `Origin: http://localhost:10000`.

## ADI — Formula Jon Driving School

ADI is the same chat as Mirra, with his own persona, facts, colours and embed. Mirra on drivingschoolsolutions.co.uk is unchanged: same opening line, same colours, same `/mirra/widget.js`.

He answers only from formulajondrivingschool.co.uk (lessons, manual or automatic, areas, prices by postcode, the free controls lesson, Theory Test Pro, booking, test centres). He does not invent a price, a pass rate or a policy. If two pages disagree, he says so and offers a callback. British English. He says "pupils".

An enquiry is still one line in `$DATA_DIR/leads.jsonl`, with `source` `website_chat` and `client` `adi`. `/mirra/leads` skips those lines. `/adi/leads` returns only them.

When someone shows interest in lessons, ADI asks if they are ready to check lesson availability. If they are, he collects the client's field list, one or two questions at a time: name, automatic or manual, phone number, pickup postcode, lesson availability, and whether they have passed the theory test. Each answer is stored and labelled in the email. If they skip one, he saves what they gave. Mirra has no availability field list, so her enquiry is unchanged. He can still book a callback or take a message.

Email uses the same webhook or SMTP as Amber and Mirra. The subject starts with `ADI (Formula Jon):`. By default the message is **To** `info@formulajondrivingschool.co.uk` and **BCC** `NOTIFY_TO_EMAIL` (the address Mirra uses, Grant). Each chat client has its own pair:

| Client | To | BCC |
|--------|----|-----|
| Amber | `NOTIFY_TO_EMAIL` | none |
| Mirra | `MIRRA_NOTIFY_TO_EMAIL`, or `NOTIFY_TO_EMAIL` if that is unset | `MIRRA_NOTIFY_BCC_EMAIL`, or none |
| ADI | `ADI_NOTIFY_TO_EMAIL`, or `info@formulajondrivingschool.co.uk` | `ADI_NOTIFY_BCC_EMAIL` if that variable is set (including empty, which sends no copy). If the variable is unset, BCC is `NOTIFY_TO_EMAIL` |

A BCC that is the same address as To is left off. Webhook deliveries include `bcc` in the JSON only when there is a copy. SMTP uses the `bcc` field.

After that email, a saved enquiry that has a phone number is also posted to DualControl at `{ADI_DUALCONTROL_API_BASE}/public/enquiries/{ADI_DUALCONTROL_FORM_KEY}`. The base defaults to `https://adiapp-backend.onrender.com/api`. The form key is a secret: set `ADI_DUALCONTROL_FORM_KEY` in the host environment and do not commit it. If the key is unset, the copy is skipped. A DualControl failure does not undo the saved enquiry or the email. Enquiries with no phone number are not posted.

The chat API accepts `https://formulajondrivingschool.co.uk` and `https://www.formulajondrivingschool.co.uk`, plus localhost unless `ADI_ALLOW_LOCALHOST=false`. Set `ADI_ALLOWED_ORIGINS` to replace that site list. A request from the Driving School Solutions site is rejected.

### WordPress (not installed yet)

Do not add this to the live Formula Jon site until Grant asks. When that happens, the bubble is one script tag:

```html
<script src="https://dss-voice-agent.onrender.com/adi/widget.js" defer></script>
```

Paste it in the site-wide footer (WPCode, or Elementor custom code at `</body>`), then clear the page cache. The opening line is: "Hi, I'm ADI from Formula Jon Driving School. How can I help?"

### Preview

`GET /adi/preview` is a stand-in page in Formula Jon's colours, with the real widget. It is not on Jon's domain.

```bash
npm start
# open http://127.0.0.1:10000/adi/preview
```

## Local development

```bash
cd /workspace/voice-agent
cp .env.example .env
# Fill XAI_API_KEY at minimum for type-checks; webhook secret needed for real calls
npm install
npm run build
npm start
# or: npm run dev
```

Health check: `curl http://127.0.0.1:10000/health`

Do **not** point a live Twilio trunk at localhost. Deploy to Render (or use a tunnel) first.

## Render deploy

`render.yaml` defines a Docker web service with a 1 GB disk mounted at `/data` for lead JSONL files.

1. Push this folder to a Git repo (or connect the existing workspace repo).
2. Create a Blueprint / Web Service from `render.yaml`, region Frankfurt preferred for UK callers.
3. Set secret env vars in the Render dashboard (see `.env.example`):
   - `XAI_API_KEY`
   - `XAI_WEBHOOK_SECRET` (after phone registration — see below)
   - `GRANT_TRANSFER_NUMBER` (Grant's personal E.164 number)
   - `NOTIFY_TO_EMAIL`
   - Either `EMAIL_WEBHOOK_URL` **or** `SMTP_*` (covers Amber and Mirra)
   - `PUBLIC_BASE_URL` = `https://<service>.onrender.com`
   - `LEADS_READ_TOKEN` if a follow-up assistant should call `GET /mirra/leads`
   - Optional: `XAI_CHAT_MODEL`, `MIRRA_REASONING_EFFORT`, `MIRRA_ALLOWED_ORIGINS`
   - Optional, for ADI: `ADI_NOTIFY_TO_EMAIL` (default `info@formulajondrivingschool.co.uk`), `ADI_NOTIFY_BCC_EMAIL` (default `NOTIFY_TO_EMAIL`), `ADI_ALLOWED_ORIGINS`, `ADI_ALLOW_LOCALHOST`, `ADI_DUALCONTROL_FORM_KEY` (secret; unset skips the DualControl copy), `ADI_DUALCONTROL_API_BASE` (default `https://adiapp-backend.onrender.com/api`)
   - Optional, for Mirra only: `MIRRA_NOTIFY_TO_EMAIL`, `MIRRA_NOTIFY_BCC_EMAIL`
4. Confirm `GET https://<service>.onrender.com/health` returns `ok: true`.

## Twilio Elastic SIP Trunk

1. Twilio Console → **Voice → Elastic SIP Trunking → create a trunk**.
2. **Origination** → add URI:  
   `sip:+442081941993@sip.voice.x.ai;transport=tls`
3. Assign phone number **+442081941993** to the trunk.
4. If Amber will transfer mid-call, enable **call transfer** on the trunk.
5. Note Twilio's SIP signalling IP ranges if you use `allowed_addresses` when registering with xAI ([Twilio SIP IP addresses](https://www.twilio.com/docs/sip-trunking/ip-addresses)).

## Register the number with xAI

After the Render URL is live:

```bash
export XAI_API_KEY=xai-...
export PUBLIC_BASE_URL=https://dss-voice-agent.onrender.com
# Optional IP allowlist for Twilio signalling:
# export TWILIO_SIP_CIDRS="54.172.60.0/23,34.203.250.0/23"
./scripts/register-phone.sh
```

Equivalent curl:

```bash
curl -X POST "https://api.x.ai/v2/phone-numbers" \
  -H "Authorization: Bearer $XAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "origin": "byo_trunk",
    "name": "Driving School Solutions — Amber",
    "phone_number": "+442081941993",
    "webhook": {
      "name": "Amber incoming",
      "url": "https://dss-voice-agent.onrender.com/webhooks/xai/incoming"
    }
  }'
```

The create response includes `webhook.dispatch_signing_secret` (**once only**). Put it in Render as `XAI_WEBHOOK_SECRET`.

List / delete later:

```bash
curl "https://api.x.ai/v2/phone-numbers" -H "Authorization: Bearer $XAI_API_KEY"
curl -X DELETE "https://api.x.ai/v2/phone-numbers/phone_abc123" \
  -H "Authorization: Bearer $XAI_API_KEY"
```

Docs: [SIP Phone Calls](https://docs.x.ai/developers/model-capabilities/audio/speech-to-speech/sip)

## Amber behaviour

- British English, no emoji.
- Prices she may quote (and no others):
  - 5-page website £299.99 (normally £599.99; offer ends 28 February 2027)
  - SEO Starter £129.99 / Growth £179.99
  - DualControl Starter free / DC Pro £11.99 / Franchise £13.99 + £9.99 per extra instructor
  - Plus local SEO, GBP, social, reviews, hosting, AI Voice Receptionist
- Tools: `save_lead`, `book_callback`, `leave_message`, `transfer_to_grant` → `POST /v1/realtime/calls/{call_id}/refer` with `tel:{GRANT_TRANSFER_NUMBER}`.

Default voice: `eve` (`XAI_VOICE`). Other built-ins include `ara`, `luna`, `iris`, `celeste` (`GET /v1/tts/voices`).

## Email / lead storage

Every tool write appends one JSON line to `$DATA_DIR/leads.jsonl`. Mirra appends to that same file with `source: "website_chat"`.

Every call, including a hangup with no speech, appends one JSON line to `$DATA_DIR/calls.jsonl` and sends a summary email (`Amber call summary: <number> at <time>`, London time). The summary carries the caller number, start time, duration, outcome, tool details, a short plain-English summary, and the full transcript. If a tool captured the caller's name, that name is stored on the call record so the next call from that number can greet them. On Render, `DATA_DIR=/data` is the `amber-leads` disk (see `render.yaml`), so these files survive restarts.

Those files are personal data. `DATA_RETENTION_DAYS` (default 30) is how long a call or lead line stays, measured from that record's own time. A line with no usable timestamp is dated the first time the purge sees it, then kept for one period. Caller-name memory uses the last call from that number: when the named line is deleted, the name and number alone are kept in `caller-names.json` until 30 days after the most recent call, then deleted too. The purge logs counts only.

Notification priority:

1. `EMAIL_WEBHOOK_URL` — POST JSON `{ to, from, subject, text, record }`
2. Else SMTP (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `NOTIFY_TO_EMAIL`)
3. Else log a clear warning and keep the JSONL only

## Open questions before go-live

- Grant's personal transfer number (`GRANT_TRANSFER_NUMBER`)
- Preferred xAI voice (default `eve`; try `ara` / `luna` for a warmer female tone)
- Email delivery method (SMTP vs webhook) and `NOTIFY_TO_EMAIL`
- Whether Twilio SIP CIDRs should be locked down via `sip_auth.allowed_addresses`
- Product packaging of this same stack as **AI Voice Receptionist** for ADI clients (separate numbers / prompts later)

## File tree

```
voice-agent/
├── Dockerfile
├── README.md
├── render.yaml
├── package.json
├── tsconfig.json
├── .env.example
├── .gitignore
├── data/                 # local JSONL (gitignored contents)
├── scripts/
│   └── register-phone.sh
└── src/
    ├── index.ts          # Express: /health + webhook
    ├── config.ts
    ├── agency-facts.ts   # Prices and services shared by Amber and Mirra
    ├── amber-prompt.ts   # British English system instructions
    ├── tools.ts          # Function tool schemas
    ├── mirra-routes.ts   # /mirra/widget.js, /mirra/chat, /mirra/leads
    ├── mirra-chat.ts     # Turn limits, tool loop, price check
    ├── mirra-prompt.ts   # Mirra's instructions (embeds the shared facts)
    ├── mirra-enquiry.ts  # Tool calls into the shared lead record
    ├── mirra-guard.ts    # Origin lock, rate limit, card refusal
    ├── mirra-tools.ts    # Chat tool schemas
    ├── mirra-widget.ts   # Mirra's colours and face on the shared bubble
    ├── chat-widget.ts    # Shared shadow-DOM bubble
    ├── adi-routes.ts     # /adi/widget.js, /adi/chat, /adi/leads, /adi/preview
    ├── adi-facts.ts      # Formula Jon facts and the price check
    ├── adi-prompt.ts     # ADI's instructions
    ├── adi-tools.ts      # Pupil enquiry tools
    ├── adi-enquiry.ts    # ADI lines in the shared lead file
    ├── adi-widget.ts     # ADI's colours, type and cap
    ├── adi-preview.ts    # Local preview page
    ├── mirra-xai.ts      # xAI Responses API client
    ├── call-session.ts   # Realtime WebSocket + tool handlers + end-of-call summary
    ├── call-context.ts   # Per-call caller-ID and returning-caller lines
    ├── call-summary.ts   # Summary text, email body, xAI fallback
    ├── caller-number.ts  # SIP/TEL From header → E.164
    ├── caller-memory.ts  # Previous name for this number
    ├── retention.ts      # Delete personal data older than DATA_RETENTION_DAYS
    ├── data-lock.ts      # Serialise JSONL appends with the purge rewrite
    ├── transcript.ts     # Caller and Amber transcript
    ├── london-time.ts    # Europe/London formatting
    ├── webhook-verify.ts # Standard Webhooks / Svix verify
    └── notify.ts         # JSONL + email
```
