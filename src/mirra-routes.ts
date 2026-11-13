/**
 * HTTP surface for a website chat. Mirra is mounted at /mirra.
 * ADI uses the same router with its own copy of the limits, origins and tools.
 */

import express from "express";
import { config } from "./config.js";
import { finalReply, handleMirraMessage, type ChatDeps, type ChatPersona } from "./mirra-chat.js";
import {
  CHAT_RATE_RULES,
  LEADS_RATE_RULES,
  bearerMatches,
  createRateLimiter,
  isAllowedOrigin,
  originPolicyFrom,
  type RateRule,
} from "./mirra-guard.js";
import { cardRefusal, contactFallback, lengthLimitMessage, mirraInstructions, rateLimitMessage } from "./mirra-prompt.js";
import { saveMirraEnquiry } from "./mirra-enquiry.js";
import { mirraWidgetJs } from "./mirra-widget.js";
import { MirraModelError } from "./mirra-xai.js";
import { LEAD_SOURCES, LEAD_TYPES, listLeads, type LeadSource, type LeadType } from "./notify.js";

export type MirraRuntime = ChatDeps & {
  chatRules?: RateRule[];
  leadsRules?: RateRule[];
};

export type ChatMount = {
  id: string;
  logTag: string;
  widgetJs: (options?: { maxMessageChars?: number }) => string;
  allowedOrigins: () => string;
  allowLocalhost: () => boolean;
  defaultOrigins: readonly string[];
  contactFallback: () => string;
  rateLimitMessage: () => string;
  persona: ChatPersona;
  tools?: readonly unknown[];
  /** "mirra" keeps phone and Mirra lines and skips other clients. */
  leadsClient: string;
  ratePrefix: string;
  previewHtml?: () => string;
};

const MIRRA_MOUNT: ChatMount = {
  id: "mirra",
  logTag: "mirra",
  widgetJs: mirraWidgetJs,
  allowedOrigins: () => config.mirraAllowedOrigins,
  allowLocalhost: () => config.mirraAllowLocalhost,
  defaultOrigins: ["https://drivingschoolsolutions.co.uk", "https://www.drivingschoolsolutions.co.uk"],
  contactFallback,
  rateLimitMessage,
  persona: {
    instructions: mirraInstructions,
    saveEnquiry: saveMirraEnquiry,
    guardReply: finalReply,
    cardRefusal,
    lengthLimitMessage,
  },
  leadsClient: "mirra",
  ratePrefix: "MIRRA",
};

export function createMirraRouter(runtime: MirraRuntime = {}): express.Router {
  return createChatRouter(MIRRA_MOUNT, runtime);
}

export function createChatRouter(mount: ChatMount, runtime: MirraRuntime = {}): express.Router {
  const router = express.Router();
  const chatLimit = createRateLimiter(runtime.chatRules ?? chatRulesFromEnv(mount.ratePrefix));
  const leadsLimit = createRateLimiter(runtime.leadsRules ?? LEADS_RATE_RULES);

  if (mount.previewHtml) {
    router.get("/preview", (_req, res) => {
      res.set("Content-Type", "text/html; charset=utf-8");
      res.set("Cache-Control", "no-store");
      res.set("X-Robots-Tag", "noindex");
      res.send(mount.previewHtml?.() ?? "");
    });
  }

  router.get("/widget.js", (_req, res) => {
    res.set("Content-Type", "application/javascript; charset=utf-8");
    res.set("Cache-Control", "public, max-age=300");
    res.set("X-Content-Type-Options", "nosniff");
    res.send(mount.widgetJs({ maxMessageChars: config.mirraMaxMessageChars }));
  });

  router.options("/chat", (req, res) => {
    if (!applyChatCors(req, res, mount)) {
      res.status(403).json({ error: "origin_not_allowed" });
      return;
    }
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type");
    res.set("Access-Control-Max-Age", "600");
    res.sendStatus(204);
  });

  router.post("/chat", async (req, res) => {
    if (!applyChatCors(req, res, mount)) {
      res.status(403).json({ error: "origin_not_allowed", reply: mount.contactFallback() });
      return;
    }
    res.set("Cache-Control", "no-store");

    const decision = chatLimit.allow(clientIp(req));
    if (!decision.ok) {
      res.set("Retry-After", String(decision.retryAfterSeconds));
      res.status(429).json({ error: "rate_limited", reply: mount.rateLimitMessage() });
      return;
    }

    const body = req.body;
    const message = body && typeof body === "object" ? (body as { message?: unknown }).message : undefined;
    const conversationId =
      body && typeof body === "object" ? (body as { conversationId?: unknown }).conversationId : undefined;

    try {
      const result = await handleMirraMessage(
        { message, conversationId },
        {
          complete: runtime.complete,
          store: runtime.store,
          now: runtime.now,
          maxUserTurns: runtime.maxUserTurns ?? config.mirraMaxUserTurns,
          maxMessageChars: runtime.maxMessageChars ?? config.mirraMaxMessageChars,
          persona: mount.persona,
          tools: runtime.tools ?? mount.tools,
        },
      );
      res.status(result.status).json(result.body);
    } catch (err) {
      const missing = err instanceof MirraModelError && err.code === "missing_key";
      console.error(`[${mount.logTag}] chat failed`, missing ? "missing_key" : "upstream");
      res.status(missing ? 503 : 502).json({
        error: missing ? "not_configured" : "unavailable",
        reply: mount.contactFallback(),
      });
    }
  });

  router.get("/leads", async (req, res) => {
    res.set("Cache-Control", "no-store");
    const decision = leadsLimit.allow(clientIp(req));
    if (!decision.ok) {
      res.set("Retry-After", String(decision.retryAfterSeconds));
      res.status(429).json({ error: "rate_limited" });
      return;
    }

    const token = config.leadsReadToken;
    if (!token) {
      res.status(503).json({ error: "LEADS_READ_TOKEN is not configured" });
      return;
    }
    if (!bearerMatches(req.header("authorization"), token)) {
      res.status(401).json({ error: "unauthorised" });
      return;
    }

    const source = queryString(req.query.source);
    const type = queryString(req.query.type);
    const since = queryString(req.query.since);
    const limitRaw = queryString(req.query.limit);

    if (source && !isLeadSource(source)) {
      res.status(400).json({ error: "source must be phone or website_chat" });
      return;
    }
    if (type && !isLeadType(type)) {
      res.status(400).json({ error: "type must be lead, callback, message, or gbp_audit" });
      return;
    }
    if (since && !Number.isFinite(Date.parse(since))) {
      res.status(400).json({ error: "since must be an ISO date" });
      return;
    }
    let limit: number | undefined;
    if (limitRaw) {
      limit = Number(limitRaw);
      if (!Number.isFinite(limit)) {
        res.status(400).json({ error: "limit must be a number" });
        return;
      }
    }

    const leads = await listLeads({
      source: source as LeadSource | undefined,
      type: type as LeadType | undefined,
      since,
      limit,
      client: mount.leadsClient,
    });
    res.json({ ok: true, count: leads.length, leads });
  });

  return router;
}

function applyChatCors(req: express.Request, res: express.Response, mount: ChatMount): boolean {
  const origin = req.header("origin");
  const policy = originPolicyFrom(mount.allowedOrigins(), mount.allowLocalhost(), mount.defaultOrigins);
  res.set("Vary", "Origin");
  if (!isAllowedOrigin(origin, policy)) return false;
  res.set("Access-Control-Allow-Origin", origin as string);
  return true;
}

function chatRulesFromEnv(prefix: string): RateRule[] {
  const perMinute = numberEnv(`${prefix}_RATE_PER_MINUTE`, CHAT_RATE_RULES[0].max);
  const perTen = numberEnv(`${prefix}_RATE_PER_10_MIN`, CHAT_RATE_RULES[1].max);
  return [
    { windowMs: 60_000, max: perMinute },
    { windowMs: 600_000, max: perTen },
  ];
}

function numberEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim() ?? "";
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(1000, Math.floor(n));
}

function clientIp(req: express.Request): string {
  return req.ip || req.socket.remoteAddress || "unknown";
}

function queryString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function isLeadSource(value: string): value is LeadSource {
  return (LEAD_SOURCES as readonly string[]).includes(value);
}

function isLeadType(value: string): value is LeadType {
  return (LEAD_TYPES as readonly string[]).includes(value);
}
