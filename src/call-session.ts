import WebSocket from "ws";
import { config } from "./config.js";
import { AMBER_GREETING_HINT, AMBER_INSTRUCTIONS } from "./amber-prompt.js";
import { AMBER_TOOLS } from "./tools.js";
import { notifyGrant, persistRecord, type LeadRecord } from "./notify.js";

export type IncomingCallMeta = {
  callId: string;
  from?: string;
  to?: string;
};

type PendingFunctionCalls = Map<
  string,
  { name: string; arguments: string; done: boolean }
>;

/**
 * Join an inbound SIP call over the xAI realtime WebSocket and run Amber.
 */
export function joinCall(meta: IncomingCallMeta): void {
  const url = `wss://api.x.ai/v1/realtime?call_id=${encodeURIComponent(meta.callId)}`;
  const ws = new WebSocket(url, {
    headers: { Authorization: `Bearer ${config.xaiApiKey()}` },
  });

  const pending = new Map<string, Promise<unknown>>();
  let closed = false;

  const log = (msg: string, extra?: unknown) => {
    if (extra !== undefined) console.log(`[call ${meta.callId}] ${msg}`, extra);
    else console.log(`[call ${meta.callId}] ${msg}`);
  };

  ws.on("open", () => {
    log("WebSocket open — sending session.update");
    ws.send(
      JSON.stringify({
        type: "session.update",
        session: {
          voice: config.voice,
          instructions: AMBER_INSTRUCTIONS,
          turn_detection: { type: "server_vad" },
          tools: AMBER_TOOLS,
          audio: {
            input: {
              transcription: {
                language_hint: "en",
                keyterms: [
                  "Driving School Solutions",
                  "DualControl",
                  "ADI",
                  "Grant Robery",
                  "Amber",
                  "Google Business Profile",
                ],
              },
            },
          },
          replace: {
            DualControl: "Dual Control",
            ADI: "A D I",
            GBP: "G B P",
          },
        },
      }),
    );

    // Greet first so the caller is not left in silence.
    ws.send(
      JSON.stringify({
        type: "response.create",
        response: {
          instructions: AMBER_GREETING_HINT,
        },
      }),
    );
  });

  ws.on("message", (data) => {
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(data.toString());
    } catch {
      log("Non-JSON message ignored");
      return;
    }

    const type = String(event.type ?? "");
    if (
      type === "response.output_audio.delta" ||
      type === "response.output_audio_transcript.delta" ||
      type === "response.function_call_arguments.delta"
    ) {
      return; // noisy
    }

    if (type === "error") {
      console.error(`[call ${meta.callId}] error event`, event);
      return;
    }

    if (type === "response.function_call_arguments.done") {
      const callId = String(event.call_id ?? "");
      const name = String(event.name ?? "");
      const argsRaw = String(event.arguments ?? "{}");
      pending.set(
        callId,
        handleToolCall(ws, meta, name, callId, argsRaw).catch((err) => {
          console.error(`[call ${meta.callId}] tool error`, err);
          return { ok: false, error: String(err) };
        }),
      );
      return;
    }

    if (type === "response.done") {
      // Parallel tool calls: wait for all outstanding tool results before continuing.
      // response.create is sent inside each tool handler after its own output.
      return;
    }

    if (
      type === "session.updated" ||
      type === "session.created" ||
      type === "conversation.created" ||
      type === "response.created" ||
      type === "response.output_audio_transcript.done"
    ) {
      log(type);
      return;
    }

    if (type.startsWith("input_audio_buffer.")) {
      if (type === "input_audio_buffer.dtmf_event_received") {
        log("DTMF", event.event);
      }
      return;
    }
  });

  ws.on("close", (code, reason) => {
    closed = true;
    log(`WebSocket closed ${code} ${reason.toString()}`);
  });

  ws.on("error", (err) => {
    console.error(`[call ${meta.callId}] WebSocket error`, err);
  });

  // Keep a reference so GC does not drop the socket while the call is live.
  void pending;
  void closed;
}

async function handleToolCall(
  ws: WebSocket,
  meta: IncomingCallMeta,
  name: string,
  toolCallId: string,
  argsRaw: string,
): Promise<unknown> {
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(argsRaw) as Record<string, unknown>;
  } catch {
    args = {};
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
    message_for_caller:
      type === "callback"
        ? "Callback request saved. Confirm to the caller that Grant will ring them back."
        : type === "message"
          ? "Message saved and will be emailed to Grant. Confirm that to the caller."
          : "Lead saved. Thank the caller and confirm Grant or the team will follow up.",
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
