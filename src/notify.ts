import fs from "node:fs/promises";
import path from "node:path";
import nodemailer from "nodemailer";
import { config, hasEmailConfigured } from "./config.js";

export type LeadRecord = {
  type: "lead" | "callback" | "message";
  callId: string;
  from?: string;
  to?: string;
  receivedAt: string;
  name?: string;
  phone?: string;
  email?: string;
  postcode?: string;
  theory_test_status?: string;
  interest?: string;
  school_or_area?: string;
  preferred_time?: string;
  message?: string;
  notes?: string;
  reason?: string;
};

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

async function appendDataFile(filename: string, record: unknown): Promise<string> {
  await ensureDataDir();
  const file = path.join(config.dataDir, filename);
  await fs.appendFile(file, `${JSON.stringify(record)}\n`, "utf8");
  return file;
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

export function renderLeadEmail(record: LeadRecord): { subject: string; text: string } {
  return { subject: subjectFor(record), text: bodyFor(record) };
}

export async function notifyGrant(record: LeadRecord): Promise<{ emailed: boolean; detail: string }> {
  const email = renderLeadEmail(record);
  return deliverEmail({
    subject: email.subject,
    text: email.text,
    record,
    logContext: { type: record.type, name: record.name },
  });
}

function subjectFor(record: LeadRecord): string {
  switch (record.type) {
    case "callback":
      return `Amber: callback request from ${record.name ?? "caller"}`;
    case "message":
      return `Amber: message from ${record.name ?? "caller"}`;
    default:
      return `Amber: new lead — ${record.name ?? "caller"}`;
  }
}

function bodyFor(record: LeadRecord): string {
  const lines = [
    `Type: ${record.type}`,
    `Received (UTC): ${record.receivedAt}`,
    `Call ID: ${record.callId}`,
    record.from ? `Caller From: ${record.from}` : null,
    record.name ? `Name: ${record.name}` : null,
    record.phone ? `Phone: ${record.phone}` : null,
    record.email ? `Email: ${record.email}` : null,
    record.postcode ? `Postcode: ${record.postcode}` : null,
    record.theory_test_status ? `Theory test: ${record.theory_test_status}` : null,
    record.school_or_area ? `School / area: ${record.school_or_area}` : null,
    record.interest ? `Interest: ${record.interest}` : null,
    record.preferred_time ? `Preferred callback: ${record.preferred_time}` : null,
    record.message ? `Message: ${record.message}` : null,
    record.notes ? `Notes: ${record.notes}` : null,
    record.reason ? `Transfer reason: ${record.reason}` : null,
    "",
    "— Amber, Driving School Solutions",
  ];
  return lines.filter((l) => l !== null).join("\n");
}

export { hasEmailConfigured };
