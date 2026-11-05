# Amber — Driving School Solutions voice receptionist

TypeScript webhook service that answers **+442081941993** via xAI Speech-to-Speech over SIP. Amber greets callers, answers FAQs, qualifies leads, books callbacks, takes messages, and can transfer to Grant Robery.

Tagline: **Turn local searches into driving students.**

This is also the foundation for the **AI Voice Receptionist** product sold to ADIs.

## Architecture

1. Caller dials the Twilio UK number.
2. Twilio Elastic SIP Trunk originates to `sip:+442081941993@sip.voice.x.ai;transport=tls`.
3. xAI POSTs a signed `realtime.call.incoming` event to `POST /webhooks/xai/incoming`.
4. This service verifies the signature, opens `wss://api.x.ai/v1/realtime?call_id=…`, sends `session.update` (Amber prompt + tools) and `response.create` so she greets first.
5. Tool calls (`save_lead`, `book_callback`, `leave_message`, `transfer_to_grant`) append JSONL under `DATA_DIR` and email Grant when SMTP or `EMAIL_WEBHOOK_URL` is set.

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/health` | Render health check |
| `POST` | `/webhooks/xai/incoming` | xAI `realtime.call.incoming` webhook |

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
   - Either `EMAIL_WEBHOOK_URL` **or** `SMTP_*`
   - `PUBLIC_BASE_URL` = `https://<service>.onrender.com`
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

Every tool write appends one JSON line to `$DATA_DIR/leads.jsonl`.

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
    ├── amber-prompt.ts   # British English system instructions
    ├── tools.ts          # Function tool schemas
    ├── call-session.ts   # Realtime WebSocket + tool handlers
    ├── webhook-verify.ts # Standard Webhooks / Svix verify
    └── notify.ts         # JSONL + email
```
