import path from "node:path";

function required(name: string, optional = false): string {
  const value = process.env[name]?.trim() ?? "";
  if (!value && !optional) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  port: Number(process.env.PORT ?? 10000),
  xaiApiKey: () => required("XAI_API_KEY"),
  xaiWebhookSecret: () => required("XAI_WEBHOOK_SECRET"),
  voice: process.env.XAI_VOICE?.trim() || "eve",
  dssPhoneNumber: process.env.DSS_PHONE_NUMBER?.trim() || "+442081941993",
  grantTransferNumber: () => required("GRANT_TRANSFER_NUMBER"),
  get notifyToEmail(): string {
    return process.env.NOTIFY_TO_EMAIL?.trim() || "";
  },
  get notifyFromEmail(): string {
    return (
      process.env.NOTIFY_FROM_EMAIL?.trim() ||
      "amber@drivingschoolsolutions.co.uk"
    );
  },
  get emailWebhookUrl(): string {
    return process.env.EMAIL_WEBHOOK_URL?.trim() || "";
  },
  get smtp() {
    return {
      host: process.env.SMTP_HOST?.trim() || "",
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: process.env.SMTP_SECURE === "true",
      user: process.env.SMTP_USER?.trim() || "",
      pass: process.env.SMTP_PASS?.trim() || "",
    };
  },
  publicBaseUrl: process.env.PUBLIC_BASE_URL?.trim() || "",
  get dataDir(): string {
    return path.resolve(process.env.DATA_DIR?.trim() || "./data");
  },
  /**
   * How long personal data on disk is kept. Unset, blank, or invalid values
   * (not a finite number, or negative) use 30 days. Zero is allowed.
   */
  get dataRetentionDays(): number {
    return parseRetentionDays(process.env.DATA_RETENTION_DAYS);
  },
  logLevel: process.env.LOG_LEVEL?.trim() || "info",
};

export function parseRetentionDays(raw: string | undefined): number {
  const trimmed = raw?.trim() ?? "";
  if (!trimmed) return 30;
  const days = Number(trimmed);
  if (!Number.isFinite(days) || days < 0) return 30;
  return days;
}

export function hasEmailConfigured(): boolean {
  if (config.emailWebhookUrl) return true;
  if (config.smtp.host && config.notifyToEmail) return true;
  return false;
}
