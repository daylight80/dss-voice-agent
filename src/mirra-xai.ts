/**
 * xAI Responses API client for Mirra. Uses the same XAI_API_KEY as Amber.
 * Web search is not enabled: Mirra may only quote the shared agency facts.
 */

import { config } from "./config.js";
import { MIRRA_TOOLS } from "./mirra-tools.js";

export type ModelRequest = {
  instructions: string;
  input: unknown[];
  conversationId: string;
};

export type ModelTurn = {
  output: unknown[];
};

export type Completer = (request: ModelRequest) => Promise<ModelTurn>;

export class MirraModelError extends Error {
  constructor(
    message: string,
    readonly code: "missing_key" | "upstream" = "upstream",
  ) {
    super(message);
    this.name = "MirraModelError";
  }
}

export type ToolCall = {
  callId: string;
  name: string;
  arguments: Record<string, unknown>;
};

/** grok-4.5 and newer reason. Older or non-reasoning ids must not be sent a reasoning field. */
export function reasoningForModel(
  model: string,
  effort: string,
): { effort: string } | undefined {
  if (/^grok-4\.(5|6|7)(\b|[^0-9])/.test(model)) return { effort };
  return undefined;
}

export function buildXaiBody(input: {
  model: string;
  effort: string;
  instructions: string;
  input: unknown[];
  conversationId: string;
}): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: input.model,
    instructions: input.instructions,
    input: input.input,
    tools: MIRRA_TOOLS,
    store: false,
    prompt_cache_key: input.conversationId,
  };
  const reasoning = reasoningForModel(input.model, input.effort);
  if (reasoning) body.reasoning = reasoning;
  return body;
}

export function readModelOutput(output: unknown[]): { text: string; calls: ToolCall[] } {
  const texts: string[] = [];
  const calls: ToolCall[] = [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    if (record.type === "function_call") {
      const name = typeof record.name === "string" ? record.name : "";
      const callId = typeof record.call_id === "string" ? record.call_id : "";
      if (!name || !callId) continue;
      calls.push({ callId, name, arguments: parseArgs(record.arguments) });
      continue;
    }
    const text = textOf(record);
    if (text) texts.push(text);
  }
  return { text: texts.join("\n").trim(), calls };
}

export async function completeWithXai(request: ModelRequest): Promise<ModelTurn> {
  let apiKey: string;
  try {
    apiKey = config.xaiApiKey();
  } catch {
    throw new MirraModelError("XAI_API_KEY is not configured", "missing_key");
  }

  const body = buildXaiBody({
    model: config.xaiChatModel,
    effort: config.mirraReasoningEffort,
    instructions: request.instructions,
    input: request.input,
    conversationId: request.conversationId,
  });

  let response: Response;
  try {
    response = await fetch("https://api.x.ai/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(45_000),
    });
  } catch (err) {
    const reason = err instanceof Error ? err.name : "error";
    throw new MirraModelError(`xAI request failed (${reason})`);
  }

  if (!response.ok) {
    throw new MirraModelError(`xAI status ${response.status}`);
  }

  const payload = (await response.json()) as { output?: unknown };
  return { output: Array.isArray(payload.output) ? payload.output : [] };
}

function textOf(record: Record<string, unknown>): string {
  if (record.type === "output_text" && typeof record.text === "string") return record.text;
  if (record.type !== "message") return "";
  if (typeof record.content === "string") return record.content;
  if (!Array.isArray(record.content)) return "";
  const parts: string[] = [];
  for (const part of record.content) {
    if (!part || typeof part !== "object") continue;
    const text = (part as { text?: unknown }).text;
    if (typeof text === "string") parts.push(text);
  }
  return parts.join("");
}

function parseArgs(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== "string" || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {
    // The model sent arguments that are not a JSON object.
  }
  return {};
}
