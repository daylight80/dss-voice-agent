/**
 * Turn a SIP From header (or a number the caller dictated) into E.164.
 * Withheld, anonymous, restricted and unavailable identities stay unknown.
 */

const WITHHELD_TOKEN =
  /^(anonymous|withheld|unavailable|restricted|unknown|private|hidden|unspecified|noreply|no-reply|null|undefined|asterisk)$/i;

const WITHHELD_HEADER =
  /\b(anonymous|withheld|unavailable|restricted|private)\b/i;

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function isWithheldToken(value: string): boolean {
  const token = value.trim().replace(/^["']+|["']+$/g, "");
  return WITHHELD_TOKEN.test(token);
}

/** True when the header is an identity with no diallable number. */
export function isWithheldCaller(from: string | undefined | null): boolean {
  if (!from?.trim()) return false;
  const uri = from.match(/(?:sip|tel):([^@>;\s]+)/i);
  if (uri && isWithheldToken(safeDecode(uri[1]))) return true;
  if (WITHHELD_HEADER.test(from) && !/\d{8,}/.test(from)) return true;
  return false;
}

/**
 * Normalise a phone-like token to E.164.
 * UK national numbers (leading 0) become +44. Already-international numbers keep their country code.
 */
export function toE164(raw: string): string | undefined {
  const compact = raw.trim().replace(/[^\d+]/g, "");
  if (!compact) return undefined;

  let digits: string;
  if (compact.startsWith("+")) {
    digits = compact.slice(1).replace(/\D/g, "");
    if (digits.length < 8 || digits.length > 15) return undefined;
    return `+${digits}`;
  }

  digits = compact.replace(/\D/g, "");
  if (digits.startsWith("00")) {
    const rest = digits.slice(2);
    if (rest.length < 8 || rest.length > 15) return undefined;
    return `+${rest}`;
  }
  // UK national: 0 plus 9 or 10 significant digits (11 digits is the common case).
  if (digits.startsWith("0") && digits.length >= 10 && digits.length <= 11) {
    return `+44${digits.slice(1)}`;
  }
  // 44 without a plus, as SIP user-parts sometimes arrive.
  if (digits.startsWith("44") && digits.length >= 11 && digits.length <= 13) {
    return `+${digits}`;
  }
  return undefined;
}

function phoneInText(text: string): string | undefined {
  const plus = text.match(/\+\s*\d[\d\s().-]{6,}\d/);
  if (plus) {
    const parsed = toE164(plus[0]);
    if (parsed) return parsed;
  }
  const national = text.match(/(?:^|[^\d])((?:00|0)\d[\d\s().-]{8,}\d)/);
  if (national) {
    const parsed = toE164(national[1]);
    if (parsed) return parsed;
  }
  const bare = text.match(/(?:^|[^\d])(44\d{9,11})(?:[^\d]|$)/);
  if (bare) {
    const parsed = toE164(bare[1]);
    if (parsed) return parsed;
  }
  return undefined;
}

/**
 * Caller number from a SIP/TEL From header, a tel URI, or a spoken number.
 * Returns undefined when the number is missing or withheld.
 */
export function callerNumberFrom(from: string | undefined | null): string | undefined {
  if (!from?.trim()) return undefined;
  if (isWithheldCaller(from)) return undefined;

  const uri = from.match(/(?:sip|tel):([^@>;\s]+)/i);
  if (uri) {
    const user = safeDecode(uri[1]);
    if (isWithheldToken(user)) return undefined;
    const fromUser = toE164(user);
    if (fromUser) return fromUser;
  }

  return phoneInText(from) ?? toE164(from);
}

export function lastThreeDigits(e164: string): string {
  const digits = e164.replace(/\D/g, "");
  return digits.slice(-3);
}

/**
 * Number to store on a tool call. A different diallable number wins;
 * anything else (blank, "the number I'm on", last three digits) uses the caller ID.
 */
export function resolveToolPhone(
  given: string | undefined,
  callerNumber: string | undefined,
): string | undefined {
  const trimmed = given?.trim();
  const parsed = trimmed ? callerNumberFrom(trimmed) : undefined;
  // A different diallable number is what they asked us to use.
  // Anything else (blank, "this number", last three digits) falls back to caller ID.
  if (parsed) return parsed;
  if (callerNumber) return callerNumber;
  return trimmed || undefined;
}

/** Per-call instruction. The base prompt is not modified. */
export function callerNumberLine(e164: string): string {
  const ending = lastThreeDigits(e164);
  return `The caller is ringing from ${e164}. When you need their number, confirm it by reading back the last three digits (for example: "Is the number you're calling from, ending ${ending}, the best one to reach you on?") rather than asking for it. If they want a different number, take that instead.`;
}
