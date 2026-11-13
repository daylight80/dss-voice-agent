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
  /** Text model for Mirra. The voice path does not read this. */
  get xaiChatModel(): string {
    return process.env.XAI_CHAT_MODEL?.trim() || "grok-4.7";
  },
  /**
   * grok-4.5 and newer reason by default at "high", which is slow for a chat
   * bubble. "low" is the setting xAI recommends for simple tool calling.
   */
  get mirraReasoningEffort(): "low" | "medium" | "high" | "xhigh" {
    const raw = process.env.MIRRA_REASONING_EFFORT?.trim().toLowerCase() || "low";
    if (raw === "low" || raw === "medium" || raw === "high" || raw === "xhigh") return raw;
    return "low";
  },
  /** Bearer token for GET /mirra/leads. Empty means the endpoint stays closed. */
  get leadsReadToken(): string {
    return process.env.LEADS_READ_TOKEN?.trim() || "";
  },
  /**
   * Comma-separated origins allowed to call Mirra. Empty uses the live site.
   * Localhost is added separately unless MIRRA_ALLOW_LOCALHOST=false.
   */
  get mirraAllowedOrigins(): string {
    return process.env.MIRRA_ALLOWED_ORIGINS?.trim() || "";
  },
  get mirraAllowLocalhost(): boolean {
    const raw = process.env.MIRRA_ALLOW_LOCALHOST?.trim().toLowerCase();
    return raw !== "false" && raw !== "0";
  },
  get mirraMaxUserTurns(): number {
    return clampInt(process.env.MIRRA_MAX_USER_TURNS, 16, 1, 40);
  },
  get mirraMaxMessageChars(): number {
    return clampInt(process.env.MIRRA_MAX_MESSAGE_CHARS, 1500, 200, 4000);
  },
  /** Overrides NOTIFY_TO_EMAIL for Mirra only. Unset keeps the shared address. */
  get mirraNotifyToEmail(): string {
    return process.env.MIRRA_NOTIFY_TO_EMAIL?.trim() || "";
  },
  /** Extra copy for Mirra. Unset means no BCC, which is how Mirra sends today. */
  get mirraNotifyBccEmail(): string {
    return process.env.MIRRA_NOTIFY_BCC_EMAIL?.trim() || "";
  },
  /**
   * Where ADI enquiry emails are addressed. Unset uses the school inbox
   * published on formulajondrivingschool.co.uk.
   */
  get adiNotifyToEmail(): string {
    return process.env.ADI_NOTIFY_TO_EMAIL?.trim() || "info@formulajondrivingschool.co.uk";
  },
  /**
   * BCC for ADI enquiry emails. Unset uses NOTIFY_TO_EMAIL (the address Mirra
   * uses). An empty value sends no BCC.
   */
  get adiNotifyBccEmail(): string {
    const raw = process.env.ADI_NOTIFY_BCC_EMAIL;
    if (raw === undefined) return process.env.NOTIFY_TO_EMAIL?.trim() || "";
    return raw.trim();
  },
  /**
   * Comma-separated origins allowed to call ADI. Empty uses the Formula Jon
   * site. Localhost is separate, via ADI_ALLOW_LOCALHOST.
   */
  get adiAllowedOrigins(): string {
    return process.env.ADI_ALLOWED_ORIGINS?.trim() || "";
  },
  get adiAllowLocalhost(): boolean {
    const raw = process.env.ADI_ALLOW_LOCALHOST?.trim().toLowerCase();
    return raw !== "false" && raw !== "0";
  },
};

function clampInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  const trimmed = raw?.trim() ?? "";
  if (!trimmed) return fallback;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

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
