import { config } from "./config.js";
import { cleanCallerName } from "./caller-memory.js";
import { durationSeconds, formatDuration, formatLondonDateTime } from "./london-time.js";
import { deliverEmail, persistCallRecord } from "./notify.js";

export type CapturedTool = {
  name: string;
  args: Record<string, unknown>;
  result: Record<string, unknown>;
  at: string;
};

const SUMMARY_MODEL = "grok-4.7";
const NO_SPEECH_SUMMARY = "No speech was captured. The caller may have hung up straight away.";
const SUMMARY_FAILED = "A short summary could not be generated. The full transcript is below.";

const FIELD_LABELS: Record<string, string> = {
  name: "Name",
  phone: "Phone",
  email: "Email",
  interest: "Interest",
  school_or_area: "School or area",
  preferred_time: "Preferred time",
  message: "Message",
  notes: "Notes",
  reason: "Reason",
};

export function callerNameFromTools(tools: CapturedTool[]): string | undefined {
  let name: string | undefined;
  for (const tool of tools) {
    const captured = cleanCallerName(tool.args.name);
    if (captured) name = captured;
  }
  return name;
}

export function outcomeFor(tools: CapturedTool[]): string {
  const labels: string[] = [];
  if (tools.some((tool) => tool.name === "save_lead" && tool.result.ok === true)) labels.push("Lead saved");
  if (tools.some((tool) => tool.name === "book_callback" && tool.result.ok === true)) {
    labels.push("Callback booked");
  }
  if (tools.some((tool) => tool.name === "leave_message" && tool.result.ok === true)) labels.push("Message taken");
  if (tools.some((tool) => tool.name === "transfer_to_grant" && tool.result.transferred === true)) {
    labels.push("Transferred to Grant");
  }
  return labels.length ? labels.join("; ") : "None";
}

function toolSucceeded(tool: CapturedTool): boolean {
  if (tool.name === "transfer_to_grant") return tool.result.transferred === true;
  return tool.result.ok === true;
}

function detailHeading(tool: CapturedTool): string {
  const ok = toolSucceeded(tool);
  switch (tool.name) {
    case "save_lead":
      return ok ? "Lead saved" : "Lead was not saved";
    case "book_callback":
      return ok ? "Callback booked" : "Callback was not booked";
    case "leave_message":
      return ok ? "Message taken" : "Message was not taken";
    case "transfer_to_grant":
      return ok ? "Transferred to Grant" : "Transfer to Grant failed";
    default:
      return ok ? tool.name : `${tool.name} failed`;
  }
}

function displayValue(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || undefined;
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}

function errorLine(result: Record<string, unknown>): string | undefined {
  if (result.ok === true) return undefined;
  const err = result.error;
  if (err == null) return undefined;
  const text = typeof err === "string" ? err : JSON.stringify(err);
  return text.length > 300 ? `${text.slice(0, 300)}...` : text;
}

export function formatToolDetails(tools: CapturedTool[]): string {
  if (!tools.length) return "None";
  return tools
    .map((tool) => {
      const lines = [detailHeading(tool)];
      for (const [key, label] of Object.entries(FIELD_LABELS)) {
        const value = displayValue(tool.args[key]);
        if (value) lines.push(`  ${label}: ${value}`);
      }
      const error = errorLine(tool.result);
      if (error) lines.push(`  Error: ${error}`);
      return lines.join("\n");
    })
    .join("\n\n");
}

export function renderCallSummaryEmail(input: {
  callId: string;
  callerNumber?: string;
  callerName?: string;
  sipFrom?: string;
  startedAt: Date;
  endedAt: Date;
  outcome: string;
  summary: string;
  details: string;
  transcript: string;
}): { subject: string; text: string } {
  const when = formatLondonDateTime(input.startedAt);
  const callerLabel = (input.callerNumber ?? "unknown number").replace(/[\r\n]+/g, " ").trim() || "unknown number";
  const subject = `Amber call summary: ${callerLabel} at ${when.time}`;
  const lines = [`Caller: ${input.callerNumber ?? "Unknown"}`];
  if (input.callerName) lines.push(`Name: ${input.callerName}`);
  if (!input.callerNumber && input.sipFrom?.trim()) lines.push(`SIP From: ${input.sipFrom.trim()}`);
  lines.push(
    `Started: ${when.date}, ${when.time} (London)`,
    `Duration: ${formatDuration(durationSeconds(input.startedAt, input.endedAt))}`,
    `Call ID: ${input.callId}`,
    `Outcome: ${input.outcome}`,
    "",
    "Summary:",
    input.summary.trim(),
    "",
    "Details captured:",
    input.details.trim() || "None",
    "",
    "Transcript:",
    input.transcript.trim() || "(no speech captured)",
    "",
    "— Amber, Driving School Solutions",
  );
  return { subject, text: lines.join("\n") };
}

type SummariseDeps = {
  fetchImpl?: typeof fetch;
  apiKey?: string;
};

export async function summariseTranscript(
  input: { transcript: string; details: string; outcome: string },
  deps?: SummariseDeps,
): Promise<{ summary: string; source: "model" | "fallback" }> {
  if (!input.transcript.trim()) {
    return { summary: NO_SPEECH_SUMMARY, source: "fallback" };
  }

  try {
    const summary = cleanSummary(await requestSummary(input, deps));
    if (!summary) throw new Error("xAI summary was empty");
    return { summary, source: "model" };
  } catch (err) {
    console.error("[call-summary] summarising failed; the transcript will still be emailed", err);
    return { summary: SUMMARY_FAILED, source: "fallback" };
  }
}

function cleanSummary(text: string): string {
  let cleaned = text.trim();
  if (
    (cleaned.startsWith('"') && cleaned.endsWith('"')) ||
    (cleaned.startsWith("“") && cleaned.endsWith("”"))
  ) {
    cleaned = cleaned.slice(1, -1).trim();
  }
  cleaned = cleaned.replace(/^summary:\s*/i, "").trim();
  return cleaned;
}

async function requestSummary(
  input: { transcript: string; details: string; outcome: string },
  deps?: SummariseDeps,
): Promise<string> {
  const apiKey = deps?.apiKey ?? config.xaiApiKey();
  const fetchImpl = deps?.fetchImpl ?? fetch;
  const transcript =
    input.transcript.length > 12_000
      ? `${input.transcript.slice(0, 12_000)}\n[transcript truncated for the summary only]`
      : input.transcript;

  const messages = [
    {
      role: "system",
      content:
        "You write short call summaries for Grant Robery, who runs Driving School Solutions in the UK. Use British English. No emoji. Two to four sentences of plain English. Mention what the caller wanted and how the call ended. Use only the transcript and the details provided. Do not invent names, numbers, prices, or promises. Do not repeat the transcript verbatim. If the caller said nothing, say so. Reply with the summary only, with no heading.",
    },
    {
      role: "user",
      content: `Outcome: ${input.outcome}\n\nDetails captured:\n${input.details}\n\nTranscript:\n${transcript}`,
    },
  ];

  return chat(
    {
      model: SUMMARY_MODEL,
      temperature: 0.2,
      max_tokens: 300,
      reasoning_effort: "low",
      messages,
    },
    fetchImpl,
    apiKey,
    true,
  );
}

async function chat(
  body: Record<string, unknown>,
  fetchImpl: typeof fetch,
  apiKey: string,
  allowRetry: boolean,
): Promise<string> {
  const res = await fetchImpl("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(25_000),
  });

  if (
    allowRetry &&
    res.status === 400 &&
    ("reasoning_effort" in body || "max_tokens" in body)
  ) {
    await res.text().catch(() => "");
    return chat(
      { model: body.model, temperature: body.temperature, messages: body.messages },
      fetchImpl,
      apiKey,
      false,
    );
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`xAI summary failed: ${res.status} ${text.slice(0, 400)}`);
  }

  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: unknown } }>;
  };
  const content = json.choices?.[0]?.message?.content;
  const text = contentToString(content);
  if (!text) throw new Error("xAI summary was empty");
  return text;
}

function contentToString(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (part && typeof part === "object" && "text" in part) {
        const text = (part as { text?: unknown }).text;
        return typeof text === "string" ? text : "";
      }
      return "";
    })
    .join("")
    .trim();
}

export type CallSummaryRecord = {
  type: "call_summary";
  callId: string;
  from?: string;
  to?: string;
  callerNumber?: string;
  callerName?: string;
  startedAt: string;
  endedAt: string;
  durationSeconds: number;
  outcome: string;
  summary: string;
  summarySource: "model" | "fallback";
  tools: Array<{
    name: string;
    at: string;
    ok: boolean;
    arguments: Record<string, unknown>;
    error?: string;
  }>;
  transcript: string;
  subject: string;
};

function storedTools(tools: CapturedTool[]): CallSummaryRecord["tools"] {
  return tools.map((tool) => {
    const error = errorLine(tool.result);
    return {
      name: tool.name,
      at: tool.at,
      ok: toolSucceeded(tool),
      arguments: tool.args,
      ...(error ? { error } : {}),
    };
  });
}

/**
 * Persist the call and email Grant. Never throws: a failure is logged and the call is already over.
 */
export async function publishCallSummary(input: {
  callId: string;
  from?: string;
  to?: string;
  callerNumber?: string;
  startedAt: Date;
  endedAt: Date;
  lines: string[];
  tools: CapturedTool[];
}): Promise<void> {
  try {
    const transcript = input.lines.join("\n");
    const details = formatToolDetails(input.tools);
    const outcome = outcomeFor(input.tools);
    const callerName = callerNameFromTools(input.tools);
    const { summary, source } = await summariseTranscript({ transcript, details, outcome });
    const email = renderCallSummaryEmail({
      callId: input.callId,
      callerNumber: input.callerNumber,
      callerName,
      sipFrom: input.from,
      startedAt: input.startedAt,
      endedAt: input.endedAt,
      outcome,
      summary,
      details,
      transcript,
    });

    const record: CallSummaryRecord = {
      type: "call_summary",
      callId: input.callId,
      from: input.from,
      to: input.to,
      callerNumber: input.callerNumber,
      callerName,
      startedAt: input.startedAt.toISOString(),
      endedAt: input.endedAt.toISOString(),
      durationSeconds: durationSeconds(input.startedAt, input.endedAt),
      outcome,
      summary,
      summarySource: source,
      tools: storedTools(input.tools),
      transcript,
      subject: email.subject,
    };

    try {
      const file = await persistCallRecord(record);
      console.log(`[call ${input.callId}] call summary saved ${file}`);
    } catch (err) {
      console.error(`[call ${input.callId}] could not persist call summary`, err);
    }

    try {
      const sent = await deliverEmail({
        subject: email.subject,
        text: email.text,
        record,
        logContext: { type: "call_summary", callId: input.callId, outcome },
      });
      console.log(`[call ${input.callId}] call summary email: ${sent.detail}`);
    } catch (err) {
      console.error(`[call ${input.callId}] could not email call summary`, err);
    }
  } catch (err) {
    console.error(`[call ${input.callId}] call summary failed`, err);
  }
}
