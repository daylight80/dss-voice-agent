import WebSocket from "ws";
import { config } from "./config.js";
import { AMBER_TOOLS } from "./tools.js";
import { notifyGrant, persistRecord, type LeadRecord } from "./notify.js";
import { callerNumberFrom, resolveToolPhone } from "./caller-number.js";
import { lookupCallerMemory, type CallerMemory } from "./caller-memory.js";
import { buildCallInstructions, buildGreetingInstructions } from "./call-context.js";
import { TranscriptLog } from "./transcript.js";
import { publishCallSummary, type CapturedTool } from "./call-summary.js";

export type IncomingCallMeta = {
  callId: string;
  from?: string;
  to?: string;
};

export type JoinOptions = {
  /** Test hook. Production opens the xAI realtime socket for this call. */
  connect?: (url: string) => WebSocket;
  /** Test hook. Defaults to the current time. */
  now?: () => Date;
  /** Test hook. Defaults to a short scan of DATA_DIR that never blocks the greeting. */
  lookupMemory?: (e164: string) => Promise<CallerMemory | undefined>;
};

const activeCalls = new Set<string>();
const summarisedCalls = new Set<string>();

function beginCall(callId: string): boolean {
  if (activeCalls.has(callId) || summarisedCalls.has(callId)) return false;
  activeCalls.add(callId);
  return true;
}

function releaseCall(callId: string): void {
  activeCalls.delete(callId);
}

/** Returns true the first time this call is allowed to send its summary. */
function claimCallSummary(callId: string): boolean {
  if (summarisedCalls.has(callId)) return false;
  summarisedCalls.add(callId);
  activeCalls.delete(callId);
  if (summarisedCalls.size > 5000) {
    const oldest = summarisedCalls.values().next().value;
    if (oldest) summarisedCalls.delete(oldest);
  }
  return true;
}

const KEYTERMS = [
  "Driving School Solutions",
  "DualControl",
  "ADI",
  "Grant Robery",
  "Amber",
  "Google Business Profile",
];

function sessionUpdate(instructions: string) {
  return {
    type: "session.update",
    session: {
      voice: config.voice,
      instructions,
      turn_detection: { type: "server_vad" },
      tools: AMBER_TOOLS,
      audio: {
        input: {
          transcription: {
            // Partials so a hangup mid-sentence is still in the transcript.
            // Prompt, greeting and voice are unchanged.
            model: "grok-transcribe",
            language_hint: "en",
            keyterms: KEYTERMS,
          },
        },
      },
      replace: {
        DualControl: "Dual Control",
        ADI: "A D I",
        GBP: "G B P",
      },
    },
  };
}

/**
 * Join an inbound SIP call over the xAI realtime WebSocket and run Amber.
 * The realtime socket closes when the caller hangs up, the transfer completes,
 * or the leg drops. That close is the end of the call: one summary is emailed then.
 */
export function joinCall(meta: IncomingCallMeta, options?: JoinOptions): void {
  if (!beginCall(meta.callId)) {
    console.log(`[call ${meta.callId}] duplicate join ignored`);
    return;
  }

  const clock = options?.now ?? (() => new Date());
  const startedAt = clock();
  const callerNumber = callerNumberFrom(meta.from);
  const log = (msg: string, extra?: unknown) => {
    if (extra !== undefined) console.log(`[call ${meta.callId}] ${msg}`, extra);
    else console.log(`[call ${meta.callId}] ${msg}`);
  };

  if (callerNumber) log(`caller number ${callerNumber}`);
  else log("caller number unknown");

  let memory: CallerMemory | undefined;
  let memorySettled = !callerNumber;
  const lookup = options?.lookupMemory ?? ((e164: string) => lookupCallerMemory(e164));
  const memoryPromise: Promise<CallerMemory | undefined> = callerNumber
    ? Promise.resolve()
        .then(() => lookup(callerNumber))
        .then((found) => {
          memory = found;
          memorySettled = true;
          if (found) log(`remembered caller ${found.name}`);
          return found;
        })
        .catch((err: unknown) => {
          memorySettled = true;
          console.error(`[call ${meta.callId}] caller memory lookup failed`, err);
          return undefined;
        })
    : Promise.resolve(undefined);

  let ws: WebSocket;
  try {
    const url = `wss://api.x.ai/v1/realtime?call_id=${encodeURIComponent(meta.callId)}`;
    ws = options?.connect
      ? options.connect(url)
      : new WebSocket(url, {
          headers: { Authorization: `Bearer ${config.xaiApiKey()}` },
        });
  } catch (err) {
    releaseCall(meta.callId);
    console.error(`[call ${meta.callId}] failed to open WebSocket`, err);
    return;
  }

  const transcript = new TranscriptLog();
  const tools: CapturedTool[] = [];
  const pending = new Map<string, Promise<unknown>>();
  let closed = false;
  let sessionSent = false;

  const sendInstructions = () => {
    if (ws.readyState !== WebSocket.OPEN) return;
    const instructions = buildCallInstructions({ callerNumber, memory });
    if (!sessionSent) {
      ws.send(JSON.stringify(sessionUpdate(instructions)));
      sessionSent = true;
      return;
    }
    // Name memory arrived after the greeting. Update instructions only.
    ws.send(JSON.stringify({ type: "session.update", session: { instructions } }));
  };

  ws.on("open", () => {
    log("WebSocket open — sending session.update");
    sendInstructions();
    // Greet immediately. Memory that is not ready yet must not hold this up.
    ws.send(
      JSON.stringify({
        type: "response.create",
        response: {
          instructions: buildGreetingInstructions(memory, startedAt),
        },
      }),
    );

    if (!memorySettled) {
      void memoryPromise.then((found) => {
        if (!found || closed || ws.readyState !== WebSocket.OPEN) return;
        log("caller memory arrived after the greeting; instructions updated");
        sendInstructions();
      });
    }
  });

  ws.on("message", (data) => {
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(data.toString()) as Record<string, unknown>;
    } catch {
      log("Non-JSON message ignored");
      return;
    }

    const type = String(event.type ?? "");
    if (type === "response.output_audio.delta" || type === "response.function_call_arguments.delta") {
      return;
    }

    try {
      transcript.ingest(event);
    } catch (err) {
      console.error(`[call ${meta.callId}] transcript event failed`, err);
    }

    if (type === "error") {
      console.error(`[call ${meta.callId}] error event`, event);
      return;
    }

    if (type === "response.function_call_arguments.done") {
      const toolCallId = String(event.call_id ?? "");
      const name = String(event.name ?? "");
      const argsRaw = String(event.arguments ?? "{}");
      pending.set(
        toolCallId,
        (async () => {
          const args = parseArgs(argsRaw);
          try {
            const result = await handleToolCall(ws, meta, name, toolCallId, args, callerNumber);
            tools.push({ name, args, result: asResult(result), at: new Date().toISOString() });
            return result;
          } catch (err) {
            console.error(`[call ${meta.callId}] tool error`, err);
            const result = { ok: false, error: String(err) };
            tools.push({ name, args, result, at: new Date().toISOString() });
            return result;
          }
        })(),
      );
      return;
    }

    if (type === "response.done") return;

    if (
      type === "session.updated" ||
      type === "session.created" ||
      type === "conversation.created" ||
      type === "response.created" ||
      type === "response.output_audio_transcript.done" ||
      type === "conversation.item.input_audio_transcription.completed"
    ) {
      log(type);
      return;
    }

    if (type.startsWith("input_audio_buffer.")) {
      if (type === "input_audio_buffer.dtmf_event_received") log("DTMF", event.event);
      return;
    }
  });

  ws.on("close", (code: number, reason: Buffer) => {
    closed = true;
    log(`WebSocket closed ${code} ${reason?.toString?.() ?? ""}`);
    if (!claimCallSummary(meta.callId)) return;
    const endedAt = clock();
    const inFlight = Array.from(pending.values());
    // The call is already over. Summarise off the socket so email cannot delay it.
    setImmediate(() => {
      void (async () => {
        try {
          await Promise.race([
            Promise.allSettled(inFlight),
            new Promise((resolve) => setTimeout(resolve, 8000)),
          ]);
          await publishCallSummary({
            callId: meta.callId,
            from: meta.from,
            to: meta.to,
            callerNumber,
            startedAt,
            endedAt,
            lines: transcript.lines(),
            tools: [...tools],
          });
        } catch (err) {
          console.error(`[call ${meta.callId}] call summary failed`, err);
        }
      })();
    });
  });

  ws.on("error", (err) => {
    console.error(`[call ${meta.callId}] WebSocket error`, err);
  });
}

function parseArgs(argsRaw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(argsRaw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // The model sent arguments that are not a JSON object.
  }
  return {};
}

function asResult(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false };
  return value as Record<string, unknown>;
}

async function handleToolCall(
  ws: WebSocket,
  meta: IncomingCallMeta,
  name: string,
  toolCallId: string,
  args: Record<string, unknown>,
  callerNumber: string | undefined,
): Promise<unknown> {
  if (name === "save_lead" || name === "book_callback" || name === "leave_message") {
    const given = typeof args.phone === "string" ? args.phone : undefined;
    const phone = resolveToolPhone(given, callerNumber);
    if (phone) args.phone = phone;
  }

  console.log(`[call ${meta.callId}] tool ${name}`, args);

  let result: Record<string, unknown>;

  switch (name) {
    case "save_lead":
      result = await saveTyped(meta, "lead", args);
      break;
    case "book_callback":
      result = await saveTyped(meta, "callback", args);
      break;
    case "leave_message":
      result = await saveTyped(meta, "message", args);
      break;
    case "transfer_to_grant":
      result = await transferToGrant(meta, args);
      break;
    default:
      result = { ok: false, error: `Unknown tool: ${name}` };
  }

  if (ws.readyState === WebSocket.OPEN) {
    ws.send(
      JSON.stringify({
        type: "conversation.item.create",
        item: {
          type: "function_call_output",
          call_id: toolCallId,
          output: JSON.stringify(result),
        },
      }),
    );
    // For a successful transfer the SIP leg moves away; still ask for a brief
    // confirmation turn in case the refer failed and we stay on the call.
    ws.send(JSON.stringify({ type: "response.create" }));
  }

  return result;
}

async function saveTyped(
  meta: IncomingCallMeta,
  type: LeadRecord["type"],
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const record: LeadRecord = {
    type,
    callId: meta.callId,
    from: meta.from,
    to: meta.to,
    receivedAt: new Date().toISOString(),
    name: str(args.name),
    phone: str(args.phone),
    email: str(args.email),
    interest: str(args.interest),
    school_or_area: str(args.school_or_area),
    preferred_time: str(args.preferred_time),
    message: str(args.message),
    notes: str(args.notes),
  };

  const file = await persistRecord(record);
  const notify = await notifyGrant(record);

  return {
    ok: true,
    saved_to: file,
    emailed: notify.emailed,
    detail: notify.detail,
    ...(record.phone ? { phone: record.phone } : {}),
    message_for_caller:
      type === "callback"
        ? "Callback request saved. Confirm to the caller that a member of our team will ring them back."
        : type === "message"
          ? "Message saved and will be emailed to the team. Confirm that to the caller."
          : "Lead saved. Thank the caller and confirm a member of our team will follow up.",
  };
}

async function transferToGrant(
  meta: IncomingCallMeta,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  let target: string;
  try {
    target = config.grantTransferNumber();
  } catch {
    return {
      ok: false,
      error: "GRANT_TRANSFER_NUMBER is not configured",
      message_for_caller:
        "Apologise and offer to take a message or book a callback instead.",
    };
  }

  const targetUri = target.startsWith("tel:") || target.startsWith("sip:")
    ? target
    : `tel:${target}`;

  const res = await fetch(
    `https://api.x.ai/v1/realtime/calls/${encodeURIComponent(meta.callId)}/refer`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.xaiApiKey()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ target_uri: targetUri }),
    },
  );

  const bodyText = await res.text().catch(() => "");
  let bodyJson: unknown = {};
  try {
    bodyJson = bodyText ? JSON.parse(bodyText) : {};
  } catch {
    bodyJson = { raw: bodyText };
  }

  await persistRecord({
    type: "message",
    callId: meta.callId,
    from: meta.from,
    to: meta.to,
    receivedAt: new Date().toISOString(),
    name: "transfer_to_grant",
    notes: `Transfer ${res.ok ? "succeeded" : "failed"} → ${targetUri}. Reason: ${str(args.reason) ?? "n/a"}. Status ${res.status}.`,
    reason: str(args.reason),
  }).catch(() => undefined);

  if (res.status === 200) {
    return {
      ok: true,
      transferred: true,
      target_uri: targetUri,
      message_for_caller: "Transfer completed. You may briefly confirm they are being connected.",
    };
  }

  return {
    ok: false,
    transferred: false,
    status: res.status,
    error: bodyJson,
    message_for_caller:
      "The transfer did not go through. Apologise, stay on the line, and offer to take a message or book a callback.",
  };
}

function str(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const t = value.trim();
  return t || undefined;
}
