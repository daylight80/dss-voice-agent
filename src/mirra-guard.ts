/**
 * Origin lock, rate limiting, and card-detail refusal for Mirra.
 * The phone webhook does not use this module.
 */

import crypto from "node:crypto";

const DEFAULT_SITE_ORIGINS = [
  "https://drivingschoolsolutions.co.uk",
  "https://www.drivingschoolsolutions.co.uk",
];

export type OriginPolicy = {
  siteOrigins: string[];
  allowLocalhost: boolean;
};

export function originPolicyFrom(
  configured: string,
  allowLocalhost: boolean,
  defaults: readonly string[] = DEFAULT_SITE_ORIGINS,
): OriginPolicy {
  const entries = configured
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const source = entries.length ? entries : defaults;
  const siteOrigins: string[] = [];
  for (const entry of source) {
    const origin = strictOrigin(entry);
    if (origin) siteOrigins.push(origin);
    else console.warn("[chat] ignoring invalid allowed-origin entry");
  }
  return { siteOrigins, allowLocalhost };
}

export function isAllowedOrigin(origin: string | undefined, policy: OriginPolicy): boolean {
  if (!origin || origin === "null") return false;
  const url = strictOriginUrl(origin);
  if (!url) return false;
  if (policy.allowLocalhost && isLoopback(url)) return true;
  return policy.siteOrigins.some((allowed) => {
    const expected = new URL(allowed);
    return expected.protocol === url.protocol && expected.host.toLowerCase() === url.host.toLowerCase();
  });
}

function strictOrigin(value: string): string | undefined {
  const url = strictOriginUrl(value);
  return url?.origin;
}

function strictOriginUrl(value: string): URL | undefined {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (url.origin !== value) return undefined;
  if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
  return url;
}

function isLoopback(url: URL): boolean {
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

export type RateRule = { windowMs: number; max: number };

export type RateDecision = { ok: true } | { ok: false; retryAfterSeconds: number };

export function createRateLimiter(rules: RateRule[]) {
  const buckets = new Map<string, number[]>();
  const longest = rules.reduce((max, rule) => Math.max(max, rule.windowMs), 0);

  function allow(key: string, now = Date.now()): RateDecision {
    const fresh = (buckets.get(key) ?? []).filter((stamp) => now - stamp < longest);
    for (const rule of rules) {
      const used = fresh.filter((stamp) => now - stamp < rule.windowMs);
      if (used.length >= rule.max) {
        buckets.set(key, fresh);
        const oldest = used[0] ?? now;
        const retryAfterSeconds = Math.max(1, Math.ceil((rule.windowMs - (now - oldest)) / 1000));
        return { ok: false, retryAfterSeconds };
      }
    }
    fresh.push(now);
    buckets.set(key, fresh);
    if (buckets.size > 5000) {
      for (const [id, stamps] of buckets) {
        if (stamps.every((stamp) => now - stamp >= longest)) buckets.delete(id);
      }
    }
    return { ok: true };
  }

  return { allow };
}

/** Default visitor budget: a short burst, then a longer cap. */
export const CHAT_RATE_RULES: RateRule[] = [
  { windowMs: 60_000, max: 8 },
  { windowMs: 600_000, max: 30 },
];

export const LEADS_RATE_RULES: RateRule[] = [{ windowMs: 600_000, max: 60 }];

/** 13 to 19 digits, optional single spaces or hyphens, ending on a digit so a trailing space is kept. */
const CARD_RE = /(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)/g;

export function containsCardNumber(text: string): boolean {
  CARD_RE.lastIndex = 0;
  for (const match of text.matchAll(CARD_RE)) {
    const digits = match[0].replace(/\D/g, "");
    if (digits.length >= 13 && digits.length <= 19 && luhn(digits)) return true;
  }
  return false;
}

export function redactCardNumbers(text: string): string {
  CARD_RE.lastIndex = 0;
  return text.replace(CARD_RE, (raw) => {
    const digits = raw.replace(/\D/g, "");
    if (digits.length >= 13 && digits.length <= 19 && luhn(digits)) return "[removed]";
    return raw;
  });
}

function luhn(digits: string): boolean {
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = digits.charCodeAt(i) - 48;
    if (n < 0 || n > 9) return false;
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

export function cleanVisitorText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/\r\n/g, "\n")
    .trim()
    .slice(0, max);
}

export function bearerMatches(header: string | undefined, token: string): boolean {
  if (!header || !token) return false;
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header);
  if (!match) return false;
  const given = Buffer.from(match[1]);
  const expect = Buffer.from(token);
  if (given.length !== expect.length) {
    crypto.timingSafeEqual(expect, expect);
    return false;
  }
  return crypto.timingSafeEqual(given, expect);
}

export function stripEmoji(text: string): string {
  return text
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/\uFE0F/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ +([.,!?;:])/g, "$1")
    .trim();
}
