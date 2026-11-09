import fs from "node:fs/promises";
import path from "node:path";
import nodemailer from "nodemailer";
import { config, hasEmailConfigured } from "./config.js";
import { withDataLock } from "./data-lock.js";

export const LEAD_TYPES = ["lead", "callback", "message", "gbp_audit"] as const;
export type LeadType = (typeof LEAD_TYPES)[number];

export const LEAD_SOURCES = ["phone", "website_chat"] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];

export type LeadRecord = {
  type: LeadType;
  /** Absent on Amber's phone records, which are treated as phone. */
  source?: LeadSource;
  callId: string;
  conversationId?: string;
  from?: string;
  to?: string;
  receivedAt: string;
  name?: string;
  phone?: string;
  email?: string;
  interest?: string;
  school_or_area?: string;
  /** "solo ADI" or "driving school" when the visitor said which they are. */
  business_type?: string;
  business_name?: string;
  town?: string;
  gbp_url?: string;
  preferred_time?: string;
  message?: string;
  notes?: string;
  reason?: string;
};

export function leadTypeLabel(type: string | undefined): string {
  if (type === "gbp_audit") return "GBP audit request";
  if (type === "lead" || type === "callback" || type === "message") return type;
  return type || "lead";
}

/** Phone records written before Mirra have no source field. */
export function leadSourceOf(record: { source?: unknown }): LeadSource {
  return record.source === "website_chat" ? "website_chat" : "phone";
}

async function ensureDataDir(): Promise<void> {
  await fs.mkdir(config.dataDir, { recursive: true });
}

export async function persistRecord(record: LeadRecord): Promise<string> {
  return appendDataFile("leads.jsonl", record);
}

/** One JSON line per call, including hangups, under DATA_DIR/calls.jsonl. */
export async function persistCallRecord(record: unknown): Promise<string> {
  return appendDataFile("calls.jsonl", record);
}

export type LeadQuery = {
  source?: LeadSource;
  type?: LeadType;
  /** Include records whose receivedAt is at or after this ISO time. */
  since?: string;
  limit?: number;
  dataDir?: string;
};

/**
 * Newest matching lines from DATA_DIR/leads.jsonl.
 * Used by the authenticated follow-up read, and safe to call while calls are appending.
 */
export async function listLeads(query: LeadQuery = {}): Promise<Record<string, unknown>[]> {
  const limit = clampLimit(query.limit);
  const sinceMs = query.since ? Date.parse(query.since) : Number.NaN;
  return withDataLock(async () => {
    const file = path.join(query.dataDir ?? config.dataDir, "leads.jsonl");
    let text = "";
    try {
      text = await fs.readFile(file, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
    const matched: Record<string, unknown>[] = [];
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        continue;
      }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
      const record = parsed as Record<string, unknown>;
      if (query.type && record.type !== query.type) continue;
      if (query.source && leadSourceOf(record) !== query.source) continue;
      if (query.since) {
        const at = typeof record.receivedAt === "string" ? Date.parse(record.receivedAt) : Number.NaN;
        if (!Number.isFinite(at) || !Number.isFinite(sinceMs) || at < sinceMs) continue;
      }
      matched.push(record);
    }
    matched.reverse();
    return matched.slice(0, limit);
  });
}

function clampLimit(limit: number | undefined): number {
  if (limit == null || !Number.isFinite(limit)) return 50;
  return Math.max(0, Math.min(200, Math.floor(limit)));
}

async function appendDataFile(filename: string, record: unknown): Promise<string> {
  return withDataLock(async () => {
    await ensureDataDir();
    const file = path.join(config.dataDir, filename);
    await fs.appendFile(file, `${JSON.stringify(record)}\n`, "utf8");
    return file;
  });
}

type EmailMessage = {
  subject: string;
  text: string;
  record: unknown;
  logContext: Record<string, unknown>;
};

export async function deliverEmail(
  message: EmailMessage,
): Promise<{ emailed: boolean; detail: string }> {
  const { subject, text: body, record } = message;

  if (config.emailWebhookUrl) {
    const res = await fetch(config.emailWebhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: config.notifyToEmail || undefined,
        from: config.notifyFromEmail,
        subject,
        text: body,
        record,
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`EMAIL_WEBHOOK_URL failed: ${res.status} ${text}`);
    }
    return { emailed: true, detail: `Posted to EMAIL_WEBHOOK_URL (${res.status})` };
  }

  if (config.smtp.host && config.notifyToEmail) {
    const transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      auth:
        config.smtp.user && config.smtp.pass
          ? { user: config.smtp.user, pass: config.smtp.pass }
          : undefined,
    });
    await transporter.sendMail({
      from: config.notifyFromEmail,
      to: config.notifyToEmail,
      subject,
      text: body,
    });
    return { emailed: true, detail: `SMTP to ${config.notifyToEmail}` };
  }

  console.warn(
    "[notify] No email configured (set EMAIL_WEBHOOK_URL or SMTP_* + NOTIFY_TO_EMAIL). Record saved to disk only.",
    message.logContext,
  );
  return {
    emailed: false,
    detail: "Logged only — configure EMAIL_WEBHOOK_URL or SMTP_*",
  };
}

export async function notifyGrant(record: LeadRecord): Promise<{ emailed: boolean; detail: string }> {
  return deliverEmail({
    subject: subjectFor(record),
    text: bodyFor(record),
    record,
    logContext: { type: record.type },
  });
}

function subjectFor(record: LeadRecord): string {
  const who = record.source === "website_chat" ? "Mirra" : "Amber";
  const whoFrom = oneLine(record.name ?? record.business_name) || (record.source === "website_chat" ? "visitor" : "caller");
  switch (record.type) {
    case "callback":
      return `${who}: callback request from ${whoFrom}`;
    case "message":
      return `${who}: message from ${whoFrom}`;
    case "gbp_audit":
      return `${who}: Google Business Profile audit request from ${whoFrom}`;
    default:
      return `${who}: new lead — ${whoFrom}`;
  }
}

function oneLine(value: string | undefined): string {
  if (!value) return "";
  return value.replace(/\s+/g, " ").trim().slice(0, 80);
}

function bodyFor(record: LeadRecord): string {
  const website = record.source === "website_chat";
  const lines = [
    `Type: ${leadTypeLabel(record.type)}`,
    website ? "Source: website chat" : null,
    `Received (UTC): ${record.receivedAt}`,
    website ? `Conversation: ${record.conversationId ?? record.callId}` : `Call ID: ${record.callId}`,
    record.from ? `Caller From: ${record.from}` : null,
    record.name ? `Name: ${record.name}` : null,
    record.phone ? `Phone: ${record.phone}` : null,
    record.email ? `Email: ${record.email}` : null,
    record.business_type ? `Business: ${record.business_type}` : null,
    record.business_name ? `Business name: ${record.business_name}` : null,
    record.town ? `Town: ${record.town}` : null,
    record.gbp_url ? `Google Business Profile: ${record.gbp_url}` : null,
    record.school_or_area ? `School / area: ${record.school_or_area}` : null,
    record.interest ? `Interest: ${record.interest}` : null,
    record.preferred_time ? `Preferred callback: ${record.preferred_time}` : null,
    record.message ? `Message: ${record.message}` : null,
    record.notes ? `Notes: ${record.notes}` : null,
    record.reason ? `Transfer reason: ${record.reason}` : null,
    "",
    website ? "— Mirra, Driving School Solutions website chat" : "— Amber, Driving School Solutions",
  ];
  return lines.filter((l) => l !== null).join("\n");
}

export { hasEmailConfigured };
