/**
 * One visitor turn: bounds, the xAI tool loop, and a reply that cannot invent a price.
 */

import crypto from "node:crypto";
import { mentionsUnknownPrice } from "./agency-facts.js";
import { saveMirraEnquiry, type EnquiryResult } from "./mirra-enquiry.js";
import { cleanVisitorText, containsCardNumber, stripEmoji } from "./mirra-guard.js";
import {
  cardRefusal,
  emptyReplyFallback,
  lengthLimitMessage,
  mirraInstructions,
  unknownPriceMessage,
} from "./mirra-prompt.js";
import { completeWithXai, readModelOutput, type Completer, type ModelRequest } from "./mirra-xai.js";
import type { LeadType } from "./notify.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type ChatTurn = { role: "user" | "assistant"; content: string };

export type Conversation = {
  id: string;
  updatedAt: number;
  userTurns: number;
  turns: ChatTurn[];
  saved: Set<string>;
};

export type ConversationStore = {
  get(id: string): Conversation | undefined;
  create(): Conversation;
  touch(conversation: Conversation): void;
  sweep(): void;
};

export function createConversationStore(options?: {
  now?: () => number;
  ttlMs?: number;
  maxConversations?: number;
}): ConversationStore {
  const now = options?.now ?? (() => Date.now());
  const ttlMs = options?.ttlMs ?? 2 * 60 * 60 * 1000;
  const maxConversations = options?.maxConversations ?? 500;
  const conversations = new Map<string, Conversation>();

  function sweep(): void {
    const cutoff = now() - ttlMs;
    for (const [id, conversation] of conversations) {
      if (conversation.updatedAt < cutoff) conversations.delete(id);
    }
    while (conversations.size > maxConversations) {
      const oldest = conversations.keys().next().value;
      if (!oldest) break;
      conversations.delete(oldest);
    }
  }

  return {
    sweep,
    get(id) {
      const found = conversations.get(id);
      if (!found) return undefined;
      if (found.updatedAt < now() - ttlMs) {
        conversations.delete(id);
        return undefined;
      }
      return found;
    },
    create() {
      sweep();
      const conversation: Conversation = {
        id: crypto.randomUUID(),
        updatedAt: now(),
        userTurns: 0,
        turns: [],
        saved: new Set(),
      };
      conversations.set(conversation.id, conversation);
      return conversation;
    },
    touch(conversation) {
      conversation.updatedAt = now();
      conversations.delete(conversation.id);
      conversations.set(conversation.id, conversation);
    },
  };
}

export type ChatBody = {
  conversationId?: string;
  reply: string;
  error?: string;
};

export type ChatResponse = { status: number; body: ChatBody };

export type ChatPersona = {
  instructions: (now: Date) => string;
  saveEnquiry: (input: {
    tool: string;
    args: Record<string, unknown>;
    conversationId: string;
    now?: Date;
    alreadySaved?: Set<string>;
  }) => Promise<EnquiryResult>;
  guardReply: (reply: string, saved: LeadType[]) => string;
  cardRefusal: () => string;
  lengthLimitMessage: () => string;
};

export type ChatDeps = {
  complete?: Completer;
  store?: ConversationStore;
  now?: () => Date;
  maxUserTurns?: number;
  maxMessageChars?: number;
  /** Unset uses Mirra. ADI passes its own copy so Mirra's path stays the same. */
  persona?: ChatPersona;
  tools?: readonly unknown[];
};

export async function handleMirraMessage(
  input: { message?: unknown; conversationId?: unknown },
  deps: ChatDeps = {},
): Promise<ChatResponse> {
  const maxChars = deps.maxMessageChars ?? 1500;
  const maxTurns = deps.maxUserTurns ?? 16;
  const now = deps.now ?? (() => new Date());
  const store = deps.store ?? defaultStore;
  const complete = deps.complete ?? completeWithXai;
  const refuseCard = deps.persona?.cardRefusal ?? cardRefusal;
  const limitMessage = deps.persona?.lengthLimitMessage ?? lengthLimitMessage;
  const instructionsFor = deps.persona?.instructions ?? mirraInstructions;
  const saveEnquiry = deps.persona?.saveEnquiry ?? saveMirraEnquiry;
  const guardReply = deps.persona?.guardReply ?? finalReply;

  if (typeof input.message !== "string") {
    return { status: 400, body: { reply: "Please type a message.", error: "empty" } };
  }
  const message = cleanVisitorText(input.message, maxChars + 1);
  if (!message) {
    return { status: 400, body: { reply: "Please type a message.", error: "empty" } };
  }
  if (message.length > maxChars) {
    return {
      status: 400,
      body: { reply: "Please shorten that message and send it again.", error: "too_long" },
    };
  }
  if (containsCardNumber(message)) {
    return { status: 400, body: { reply: refuseCard(), error: "card_details" } };
  }

  const requested =
    typeof input.conversationId === "string" && UUID_RE.test(input.conversationId)
      ? input.conversationId
      : undefined;
  const existing = requested ? store.get(requested) : undefined;
  const conversation = existing ?? store.create();

  if (conversation.userTurns >= maxTurns) {
    return {
      status: 200,
      body: {
        conversationId: conversation.id,
        reply: limitMessage(),
        error: "length_limit",
      },
    };
  }

  const instructions = instructionsFor(now());
  const modelInput: unknown[] = [
    ...conversation.turns.map((turn) => ({ role: turn.role, content: turn.content })),
    { role: "user", content: message },
  ];
  const saved: LeadType[] = [];
  let reply = "";

  for (let round = 0; round < 3; round++) {
    const request: ModelRequest = {
      instructions,
      input: modelInput,
      conversationId: conversation.id,
      tools: deps.tools,
    };
    let turn;
    try {
      turn = await complete(request);
    } catch (err) {
      if (saved.length) {
        reply = stockReply(saved);
        break;
      }
      throw err;
    }

    const parsed = readModelOutput(turn.output);
    if (!parsed.calls.length) {
      reply = parsed.text;
      break;
    }

    modelInput.push(...turn.output);
    for (const call of parsed.calls) {
      const result = await saveEnquiry({
        tool: call.name,
        args: call.arguments,
        conversationId: conversation.id,
        now: now(),
        alreadySaved: conversation.saved,
      });
      if (result.key && (result.saved || result.duplicate)) conversation.saved.add(result.key);
      if (result.saved && result.type) saved.push(result.type);
      modelInput.push({
        type: "function_call_output",
        call_id: call.callId,
        output: JSON.stringify(result.body),
      });
    }
    reply = parsed.text;
  }

  reply = guardReply(reply, saved);
  conversation.turns.push({ role: "user", content: message });
  conversation.turns.push({ role: "assistant", content: reply });
  conversation.userTurns += 1;
  if (conversation.turns.length > 40) {
    conversation.turns.splice(0, conversation.turns.length - 40);
  }
  store.touch(conversation);

  return { status: 200, body: { conversationId: conversation.id, reply } };
}

export function finalReply(reply: string, saved: LeadType[]): string {
  const cleaned = stripEmoji(reply);
  const usable = cleaned && !mentionsUnknownPrice(cleaned) ? cleaned.slice(0, 2000) : "";
  if (usable) return usable;
  if (saved.length) return stockReply(saved);
  if (cleaned && mentionsUnknownPrice(cleaned)) return unknownPriceMessage();
  return emptyReplyFallback();
}

function stockReply(saved: LeadType[]): string {
  if (saved.includes("gbp_audit")) {
    return "Thanks. I've passed your Google Business Profile audit request to the team. They will email you the short free report. Is there anything else I can help with?";
  }
  if (saved.includes("callback")) {
    return "Thanks. I've booked that callback with a member of the team. Is there anything else I can help with?";
  }
  if (saved.includes("message")) {
    return "Thanks. I've passed your message to the team. Is there anything else I can help with?";
  }
  if (saved.includes("lead")) {
    return "Thanks. I've passed your details to the team and they will be in touch. Is there anything else I can help with?";
  }
  return emptyReplyFallback();
}

export const defaultStore = createConversationStore();
