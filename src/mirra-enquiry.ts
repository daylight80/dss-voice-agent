/**
 * Turn a Mirra tool call into the same lead record Amber writes, tagged as website chat.
 */

import { config } from "./config.js";
import { containsCardNumber, redactCardNumbers } from "./mirra-guard.js";
import { notifyGrant, persistRecord, type LeadRecord, type LeadType } from "./notify.js";

export type EnquiryResult = {
  saved: boolean;
  duplicate: boolean;
  type?: LeadType;
  body: Record<string, unknown>;
  key?: string;
};

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** One question in a client's lesson-availability enquiry, in the order to ask it. */
export type EnquiryField = {
  /** Tool argument and storage key. */
  key: string;
  /** Label in the notification email. */
  label: string;
  /** How the assistant should ask. */
  ask: string;
  /** yes_no becomes Yes or No. lesson_type becomes automatic, manual, or not sure when the answer is clear. */
  kind?: "text" | "yes_no" | "lesson_type";
  max?: number;
};

export type EnquiryProfile = {
  /** Stored on the lead. Leave unset for Mirra so the JSON line stays unchanged. */
  clientId?: string;
  /** When set, only these tools are accepted. Mirra uses the built-in list. */
  tools?: Record<string, LeadType>;
  /** Pupil enquiries must name an area and manual or automatic. */
  requireLessonDetails?: boolean;
  /**
   * Ordered availability questions. When set, a lesson enquiry saves whatever
   * subset the visitor agreed to give. Mirra leaves this unset.
   */
  availabilityFields?: EnquiryField[];
  /** To address. Unset uses NOTIFY_TO_EMAIL. */
  notifyTo?: () => string | undefined;
  /** BCC address. Unset sends no copy. */
  notifyBcc?: () => string | undefined;
  confirmations?: Partial<Record<LeadType, string>>;
};

/** Mirra's addresses. Empty env vars keep To on NOTIFY_TO_EMAIL and send no BCC. */
const MIRRA_NOTIFY: EnquiryProfile = {
  notifyTo: () => config.mirraNotifyToEmail || undefined,
  notifyBcc: () => config.mirraNotifyBccEmail || undefined,
};

export async function saveMirraEnquiry(
  input: {
    tool: string;
    args: Record<string, unknown>;
    conversationId: string;
    now?: Date;
    alreadySaved?: Set<string>;
  },
  profile: EnquiryProfile = MIRRA_NOTIFY,
): Promise<EnquiryResult> {
  const type = typeForTool(input.tool, profile.tools);
  if (!type) {
    return { saved: false, duplicate: false, body: { ok: false, error: `Unknown tool: ${input.tool}` } };
  }

  const fields = readFields(input.args, profile);
  const problem = validate(type, fields, profile);
  if (problem) {
    return { saved: false, duplicate: false, type, body: { ok: false, error: problem } };
  }

  const record = toRecord(type, fields, input.conversationId, input.now ?? new Date(), profile);
  const key = enquiryKey(record);
  if (input.alreadySaved?.has(key)) {
    return {
      saved: false,
      duplicate: true,
      type,
      key,
      body: {
        ok: true,
        duplicate: true,
        message_for_visitor: "This is already saved. Confirm it once. Do not save it again.",
      },
    };
  }

  await persistRecord(record);
  try {
    const to = profile.notifyTo?.()?.trim() || undefined;
    const bcc = profile.notifyBcc?.()?.trim() || undefined;
    await notifyGrant(record, to || bcc ? { to, bcc } : undefined);
  } catch (err) {
    console.error(`[${profile.clientId ?? "mirra"}] email failed after the record was saved`, err);
  }

  return {
    saved: true,
    duplicate: false,
    type,
    key,
    body: {
      ok: true,
      message_for_visitor: confirmation(type, profile),
    },
  };
}

function typeForTool(tool: string, tools?: Record<string, LeadType>): LeadType | undefined {
  if (tools) return tools[tool];
  switch (tool) {
    case "save_lead":
      return "lead";
    case "book_callback":
      return "callback";
    case "leave_message":
      return "message";
    case "request_gbp_audit":
      return "gbp_audit";
    default:
      return undefined;
  }
}

type Fields = {
  name?: string;
  phone?: string;
  email?: string;
  interest?: string;
  school_or_area?: string;
  business_type?: string;
  business_name?: string;
  town?: string;
  gbp_url?: string;
  preferred_time?: string;
  message?: string;
  notes?: string;
  transmission?: string;
  details?: Array<{ key: string; label: string; value: string }>;
};

function readFields(args: Record<string, unknown>, profile: EnquiryProfile): Fields {
  return {
    name: text(args.name, 120),
    phone: text(args.phone, 40),
    email: text(args.email, 200),
    interest: text(args.interest, 300),
    school_or_area: text(args.school_or_area, 200) || text(args.area, 200),
    transmission: normaliseTransmission(text(args.transmission, 80)),
    business_type: businessType(text(args.business_type, 80)),
    business_name: text(args.business_name, 160),
    town: text(args.town, 120),
    gbp_url: text(args.gbp_url, 500),
    preferred_time: text(args.preferred_time, 200),
    message: text(args.message, 2000),
    notes: text(args.notes, 1000),
    details: readAvailability(args, profile),
  };
}

function readAvailability(
  args: Record<string, unknown>,
  profile: EnquiryProfile,
): Array<{ key: string; label: string; value: string }> | undefined {
  if (!profile.availabilityFields?.length) return undefined;
  const details = [];
  for (const field of profile.availabilityFields) {
    const raw = text(args[field.key], field.max ?? 300);
    const value = field.kind === "yes_no" ? yesNo(raw) : field.kind === "lesson_type" ? lessonType(raw) : raw;
    if (value) details.push({ key: field.key, label: field.label, value });
  }
  return details.length ? details : undefined;
}

function lessonType(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return normaliseTransmission(value) ?? value;
}

function yesNo(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const lower = value.toLowerCase();
  if (/\b(not yet|haven't|haven’t|have not|not passed|no|nope)\b/.test(lower)) return "No";
  if (/^(y|yes|yeah|yep)\b/.test(lower) || /\bpassed\b/.test(lower)) return "Yes";
  return value;
}

function text(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const cleaned = redactCardNumbers(value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, " "))
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned || cleaned === "[removed]") return undefined;
  return cleaned.slice(0, max);
}

function normaliseTransmission(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const lower = value.toLowerCase();
  if (/\b(not sure|unsure|either|undecided|don't know|do not know)\b/.test(lower)) return "not sure";
  const automatic = /automatic|\bauto\b/.test(lower);
  const manual = /manual/.test(lower);
  if (automatic && manual) return "not sure";
  if (automatic) return "automatic";
  if (manual) return "manual";
  return undefined;
}

function businessType(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const lower = value.toLowerCase();
  if (lower.includes("solo") || lower === "adi" || lower.includes("independent instructor")) return "solo ADI";
  if (lower.includes("school")) return "driving school";
  return value;
}

function validate(type: LeadType, fields: Fields, profile: EnquiryProfile): string | undefined {
  if (fields.phone && containsCardNumber(fields.phone)) {
    return "That is not a phone number. Ask for a phone number, and do not store card details.";
  }
  if (fields.email && !EMAIL_RE.test(fields.email)) {
    return "That email does not look usable. Ask them to type it again.";
  }
  if (fields.gbp_url) {
    const urlError = checkUrl(fields.gbp_url);
    if (urlError) return urlError;
  }

  if (type === "gbp_audit") {
    if (!fields.business_name) return "Ask for the business name before requesting the audit.";
    if (!fields.town) return "Ask which town they cover before requesting the audit.";
    if (!fields.name) fields.name = fields.business_name;
    return needContact(fields);
  }

  if (profile.availabilityFields?.length && type === "lead") {
    return availabilityReady(fields);
  }

  if (!fields.name || fields.name.length < 2) return "Ask for their name before saving.";

  if (type === "callback") {
    if (!fields.phone) return "Ask for the phone number to call back on.";
    if (!fields.preferred_time) return "Ask when they would like the callback.";
    return lessonDetails(fields, profile);
  }

  if (type === "message") {
    if (!fields.message) return "Ask what message they would like passed on.";
    return needContact(fields);
  }

  const contact = needContact(fields);
  if (contact) return contact;
  return lessonDetails(fields, profile);
}

function availabilityReady(fields: Fields): string | undefined {
  if (fields.name && fields.name.length < 2) {
    return "That name is too short. Ask once more, and a first name is enough. If they would rather not say, save the other details.";
  }
  if (fields.details?.length || fields.email) return undefined;
  return "Ask whether they are ready to check lesson availability. Save whatever they are happy to give, but at least one detail is needed.";
}

function lessonDetails(fields: Fields, profile: EnquiryProfile): string | undefined {
  if (!profile.requireLessonDetails) return undefined;
  if (!fields.school_or_area) return "Ask which area or postcode they want lessons in before saving.";
  if (!fields.transmission) {
    return "Ask whether they want manual or automatic lessons before saving. Not sure is fine.";
  }
  return undefined;
}

function needContact(fields: Fields): string | undefined {
  if (!fields.phone && !fields.email) {
    return "Ask for a phone number or an email address before saving.";
  }
  return undefined;
}

function checkUrl(value: string): string | undefined {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "That Google Business Profile link is not a valid web address. Ask for it again, or continue without it.";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return "The Google Business Profile link needs to start with https. Ask for it again, or continue without it.";
  }
  return undefined;
}

function toRecord(
  type: LeadType,
  fields: Fields,
  conversationId: string,
  now: Date,
  profile: EnquiryProfile,
): LeadRecord {
  const town = fields.town;
  const record: LeadRecord = {
    type,
    source: "website_chat",
    callId: `chat:${conversationId}`,
    conversationId,
    receivedAt: now.toISOString(),
    name: fields.name,
    phone: fields.phone,
    email: fields.email,
    interest: type === "gbp_audit" ? fields.interest || "Google Business Profile audit" : fields.interest,
    school_or_area: fields.school_or_area || town,
    business_type: fields.business_type,
    business_name: fields.business_name,
    town,
    gbp_url: fields.gbp_url,
    preferred_time: fields.preferred_time,
    message: fields.message,
    notes: fields.notes,
  };
  if (profile.clientId) {
    record.client = profile.clientId;
    if (fields.transmission) record.transmission = fields.transmission;
  }
  if (fields.details?.length) {
    record.details = fields.details;
    const pickup = fields.details.find((detail) => detail.key === "pickup_postcode")?.value;
    if (pickup && !record.school_or_area) record.school_or_area = pickup;
    const named = fields.details.find((detail) => detail.key === "name")?.value;
    const phone = fields.details.find((detail) => detail.key === "phone")?.value;
    if (named && !record.name) record.name = named;
    if (phone && !record.phone) record.phone = phone;
  }
  return record;
}

function enquiryKey(record: LeadRecord): string {
  return [
    record.type,
    record.name,
    record.phone,
    record.email,
    record.message,
    record.business_name,
    record.town,
    record.preferred_time,
    record.interest,
    record.gbp_url,
    record.transmission,
    record.client,
    ...(record.details ?? []).map((detail) => detail.value),
  ]
    .map((part) => (part ?? "").toLowerCase())
    .join("|");
}

function confirmation(type: LeadType, profile: EnquiryProfile): string {
  const custom = profile.confirmations?.[type];
  if (custom) return custom;
  switch (type) {
    case "callback":
      return "Callback saved. Confirm to the visitor that a member of the team will call them. Do not invent a time they did not give.";
    case "message":
      return "Message saved. Confirm it will be passed to the team.";
    case "gbp_audit":
      return "Google Business Profile audit request saved. Confirm the team will email the short free report. Do not invent extra findings or a price.";
    default:
      return "Lead saved. Thank them and confirm a member of the team will follow up.";
  }
}
