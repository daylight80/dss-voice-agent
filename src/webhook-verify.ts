import crypto from "node:crypto";
import { Webhook } from "svix";

/**
 * xAI / SpaceXSI phone-number webhooks use Standard Webhooks v1
 * (webhook-id, webhook-timestamp, webhook-signature), same as Svix.
 * Prefer the svix library; fall back to manual HMAC if needed.
 */
export function verifyXaiWebhook(
  rawBody: string | Buffer,
  headers: Record<string, string | string[] | undefined>,
  secret: string,
): unknown {
  const payload = typeof rawBody === "string" ? rawBody : rawBody.toString("utf8");
  const id = header(headers, "webhook-id");
  const timestamp = header(headers, "webhook-timestamp");
  const signature = header(headers, "webhook-signature");

  if (!id || !timestamp || !signature) {
    throw new Error("Missing webhook-id, webhook-timestamp or webhook-signature");
  }

  try {
    const wh = new Webhook(secret);
    return wh.verify(payload, {
      "webhook-id": id,
      "webhook-timestamp": timestamp,
      "webhook-signature": signature,
    });
  } catch (svixError) {
    // Manual Standard Webhooks fallback (HMAC-SHA256 of `${id}.${timestamp}.${body}`)
    verifyManual(payload, id, timestamp, signature, secret);
    return JSON.parse(payload);
  }
}

function header(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const value = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(value)) return value[0];
  return value;
}

function verifyManual(
  payload: string,
  id: string,
  timestamp: string,
  signatureHeader: string,
  secret: string,
): void {
  const now = Math.floor(Date.now() / 1000);
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > 300) {
    throw new Error("Webhook timestamp outside tolerance");
  }

  let key = secret;
  if (secret.startsWith("whsec_")) {
    key = Buffer.from(secret.slice("whsec_".length), "base64").toString("binary");
  }
  const toSign = `${id}.${timestamp}.${payload}`;
  const expected = crypto
    .createHmac("sha256", Buffer.from(key, "binary"))
    .update(toSign)
    .digest("base64");

  const candidates = signatureHeader.split(" ").flatMap((part) => {
    const [, sig] = part.split(",");
    return sig ? [sig] : [];
  });

  const ok = candidates.some((sig) => {
    try {
      return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
    } catch {
      return false;
    }
  });

  if (!ok) {
    throw new Error("Invalid webhook signature");
  }
}
