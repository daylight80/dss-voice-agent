#!/usr/bin/env bash
# Register the DSS Twilio number with xAI as a BYO SIP trunk destination.
# Run AFTER this webhook is publicly reachable on HTTPS.
#
# Usage:
#   export XAI_API_KEY=...
#   export PUBLIC_BASE_URL=https://dss-voice-agent.onrender.com
#   # Optional: Twilio Elastic SIP signalling CIDRs (comma-separated)
#   export TWILIO_SIP_CIDRS="54.172.60.0/23,34.203.250.0/23"
#   ./scripts/register-phone.sh
#
# Save webhook.dispatch_signing_secret from the response as XAI_WEBHOOK_SECRET.
set -euo pipefail

: "${XAI_API_KEY:?Set XAI_API_KEY}"
: "${PUBLIC_BASE_URL:?Set PUBLIC_BASE_URL (no trailing slash)}"

PHONE="${DSS_PHONE_NUMBER:-+442081941993}"
WEBHOOK_URL="${PUBLIC_BASE_URL}/webhooks/xai/incoming"

BODY=$(jq -n \
  --arg phone "$PHONE" \
  --arg url "$WEBHOOK_URL" \
  --arg cidrs "${TWILIO_SIP_CIDRS:-}" \
  '
  {
    origin: "byo_trunk",
    name: "Driving School Solutions — Amber",
    phone_number: $phone,
    webhook: {
      name: "Amber incoming",
      url: $url
    }
  }
  + (if $cidrs == "" then {} else {
      sip_auth: {
        allowed_addresses: ($cidrs | split(",") | map(gsub("^\\s+|\\s+$";"")))
      }
    } end)
  ')

echo "POST https://api.x.ai/v2/phone-numbers"
echo "$BODY" | jq .
echo

curl -sS -X POST "https://api.x.ai/v2/phone-numbers" \
  -H "Authorization: Bearer ${XAI_API_KEY}" \
  -H "Content-Type: application/json" \
  -d "$BODY" | tee /tmp/xai-phone-register.json | jq .

echo
echo "IMPORTANT: copy webhook.dispatch_signing_secret into XAI_WEBHOOK_SECRET (shown only once)."
echo "Twilio Elastic SIP Trunk origination URI:"
echo "  sip:${PHONE}@sip.voice.x.ai;transport=tls"
