/**
 * Copy a saved ADI enquiry into DualControl. The form key is a secret and
 * is never written to the log. Mirra does not use this module.
 */

import { config } from "./config.js";

const MESSAGE_CAP = 1000;
const DEFAULT_TIMEOUT_MS = 5000;

export type AdiEnquirySource = {
  name?: string;
  phone?: string;
  email?: string;
  lesson_type?: string;
  pickup_postcode?: string;
  lesson_availability?: string;
  theory_passed?: string;
  notes?: string;
  interest?: string;
  message?: string;
  preferred_time?: string;
};

export type DualControlEnquiryBody = {
  name: string;
  phone: string;
  email: "";
  postcode?: string;
  availability?: string;
  theory_test?: "Not yet" | "Booked" | "Passed";
  transmission?: "Manual" | "Automatic";
  message: string;
  consent: "Happy to be contacted";
  company_website: "";
};

export type DualControlSendResult = "sent" | "skipped" | "failed";

/** Turn an ADI enquiry into the DualControl body, or undefined when it cannot be sent. */
export function mapAdiEnquiryToDualControl(source: AdiEnquirySource): DualControlEnquiryBody | undefined {
  const phone = clip(source.phone, 30);
  const name = clip(source.name, 100);
  if (!phone || !name) return undefined;

  const leftovers: string[] = [];
  const postcode = postcodeFor(source.pickup_postcode, leftovers);
  const theory = theoryFor(source.theory_passed, leftovers);
  const transmission = transmissionFor(source.lesson_type, leftovers);
  if (source.email?.trim()) leftovers.push(`Email: ${source.email.trim()}`);
  if (source.preferred_time?.trim()) leftovers.push(`Callback: ${oneLine(source.preferred_time)}`);
  if (source.interest?.trim()) leftovers.push(oneLine(source.interest));
  if (source.notes?.trim()) leftovers.push(oneLine(source.notes));
  if (source.message?.trim()) leftovers.push(oneLine(source.message));

  const body: DualControlEnquiryBody = {
    name,
    phone,
    email: "",
    message: clip(["Via ADI website chat", ...leftovers].join(". "), MESSAGE_CAP) ?? "Via ADI website chat",
    consent: "Happy to be contacted",
    company_website: "",
  };
  if (postcode) body.postcode = postcode;
  if (source.lesson_availability?.trim()) body.availability = oneLine(source.lesson_availability);
  if (theory) body.theory_test = theory;
  if (transmission) body.transmission = transmission;
  return body;
}

/**
 * POST the enquiry after it has already been saved and emailed.
 * Missing key, missing phone, or missing name skips the call.
 * A network or HTTP failure is logged and swallowed.
 */
export async function sendAdiEnquiryToDualControl(
  source: AdiEnquirySource,
  options?: { fetchImpl?: typeof fetch; timeoutMs?: number },
): Promise<DualControlSendResult> {
  const key = config.adiDualControlFormKey;
  if (!key) return "skipped";
  const body = mapAdiEnquiryToDualControl(source);
  if (!body) return "skipped";

  const fetchImpl = options?.fetchImpl ?? fetch;
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const base = config.adiDualControlApiBase.replace(/\/$/, "");
  const url = `${base}/public/enquiries/${encodeURIComponent(key)}`;
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      console.error("[adi] DualControl enquiry was not accepted", response.status);
      return "failed";
    }
    return "sent";
  } catch (err) {
    const reason = err instanceof Error ? err.name : "error";
    console.error("[adi] DualControl enquiry failed", reason);
    return "failed";
  }
}

export function adiEnquirySourceFromArgs(args: Record<string, unknown>): AdiEnquirySource {
  return {
    name: asText(args.name),
    phone: asText(args.phone),
    email: asText(args.email),
    lesson_type: asText(args.lesson_type) ?? asText(args.transmission),
    pickup_postcode: asText(args.pickup_postcode),
    lesson_availability: asText(args.lesson_availability),
    theory_passed: asText(args.theory_passed),
    notes: asText(args.notes),
    interest: asText(args.interest),
    message: asText(args.message),
    preferred_time: asText(args.preferred_time),
  };
}

function asText(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function clip(value: string | undefined, max: number): string | undefined {
  const cleaned = value?.replace(/\s+/g, " ").trim() ?? "";
  if (!cleaned) return undefined;
  return cleaned.slice(0, max);
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function postcodeFor(value: string | undefined, leftovers: string[]): string | undefined {
  const cleaned = value?.replace(/\s+/g, " ").trim().toUpperCase() ?? "";
  if (!cleaned) return undefined;
  if (cleaned.length > 10) {
    leftovers.push(`Pickup postcode: ${cleaned}`);
    return undefined;
  }
  return cleaned;
}

function theoryFor(
  value: string | undefined,
  leftovers: string[],
): "Not yet" | "Booked" | "Passed" | undefined {
  const cleaned = value?.trim() ?? "";
  if (!cleaned) return undefined;
  const lower = cleaned.toLowerCase();
  if (lower === "yes" || lower === "passed" || lower === "y") return "Passed";
  if (lower === "no" || lower === "not yet" || lower === "n") return "Not yet";
  if (lower === "booked") return "Booked";
  leftovers.push(`Theory test: ${oneLine(cleaned)}`);
  return undefined;
}

function transmissionFor(value: string | undefined, leftovers: string[]): "Manual" | "Automatic" | undefined {
  const cleaned = value?.trim() ?? "";
  if (!cleaned) return undefined;
  const lower = cleaned.toLowerCase();
  if (lower === "automatic" || lower === "auto") return "Automatic";
  if (lower === "manual") return "Manual";
  if (lower === "not sure" || lower === "unsure" || lower === "either") {
    leftovers.push("Lesson type: not sure");
    return undefined;
  }
  leftovers.push(`Lesson type: ${oneLine(cleaned)}`);
  return undefined;
}
