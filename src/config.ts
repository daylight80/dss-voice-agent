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
  notifyToEmail: process.env.NOTIFY_TO_EMAIL?.trim() || "",
  notifyFromEmail:
    process.env.NOTIFY_FROM_EMAIL?.trim() ||
    "amber@drivingschoolsolutions.co.uk",
  emailWebhookUrl: process.env.EMAIL_WEBHOOK_URL?.trim() || "",
  smtp: {
    host: process.env.SMTP_HOST?.trim() || "",
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === "true",
    user: process.env.SMTP_USER?.trim() || "",
    pass: process.env.SMTP_PASS?.trim() || "",
  },
  publicBaseUrl: process.env.PUBLIC_BASE_URL?.trim() || "",
  dataDir: path.resolve(process.env.DATA_DIR?.trim() || "./data"),
  logLevel: process.env.LOG_LEVEL?.trim() || "info",
};

export function hasEmailConfigured(): boolean {
  if (config.emailWebhookUrl) return true;
  if (config.smtp.host && config.notifyToEmail) return true;
  return false;
}
