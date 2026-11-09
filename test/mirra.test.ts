import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { AMBER_INSTRUCTIONS } from "../src/amber-prompt.js";
import { mentionsUnknownPrice, PRICES, sharedAgencyFacts } from "../src/agency-facts.js";
import { createApp } from "../src/index.js";
import { createConversationStore, finalReply, handleMirraMessage } from "../src/mirra-chat.js";
import { saveMirraEnquiry } from "../src/mirra-enquiry.js";
import {
  bearerMatches,
  containsCardNumber,
  createRateLimiter,
  isAllowedOrigin,
  originPolicyFrom,
  redactCardNumbers,
} from "../src/mirra-guard.js";
import { mirraInstructions, MIRRA_OPENING } from "../src/mirra-prompt.js";
import { mirraWidgetJs } from "../src/mirra-widget.js";
import { buildXaiBody, readModelOutput, type Completer } from "../src/mirra-xai.js";
import { listLeads, notifyGrant, type LeadRecord } from "../src/notify.js";

const APPROVED_AMBER_SCRIPT =
  "fa867076186a26611df2c557ffa381eedcee5715b3e6571cfe391796717db28b";

test("Amber's approved script is unchanged and Mirra quotes the same facts", () => {
  const hash = crypto.createHash("sha256").update(AMBER_INSTRUCTIONS).digest("hex");
  assert.equal(hash, APPROVED_AMBER_SCRIPT);
  const facts = sharedAgencyFacts();
  assert.ok(AMBER_INSTRUCTIONS.includes(facts));
  const mirra = mirraInstructions(new Date("2026-11-09T10:00:00.000Z"));
  assert.ok(mirra.includes(facts));
  for (const price of Object.values(PRICES)) {
    assert.ok(facts.includes(price), price);
  }
  assert.match(mirra, /Never claim to be human/);
  assert.match(mirra, /Never take card details/);
  assert.doesNotMatch(mirra, /Grant/);
  assert.equal(mentionsUnknownPrice("The five-page offer is £299.99, normally £599.99."), false);
  assert.equal(mentionsUnknownPrice("That would be £1,500."), true);
  assert.equal(mentionsUnknownPrice("It is $299."), true);
  assert.equal(mentionsUnknownPrice(`Franchise is ${PRICES.franchise}.`), false);
});

test("chat requests stay on the agency facts and do not enable web search", () => {
  const low = buildXaiBody({
    model: "grok-4.7",
    effort: "low",
    instructions: "facts",
    input: [{ role: "user", content: "hello" }],
    conversationId: "conv-1",
  });
  assert.equal(low.model, "grok-4.7");
  assert.equal(low.store, false);
  assert.deepEqual(low.reasoning, { effort: "low" });
  assert.equal(JSON.stringify(low).includes("web_search"), false);
  assert.equal(JSON.stringify(low).includes("transfer_to_grant"), false);
  assert.equal(JSON.stringify(low).includes("request_gbp_audit"), true);

  const plain = buildXaiBody({
    model: "grok-4.20-0309-non-reasoning",
    effort: "low",
    instructions: "facts",
    input: [],
    conversationId: "conv-1",
  });
  assert.equal(plain.reasoning, undefined);

  const parsed = readModelOutput([
    { type: "reasoning", encrypted_content: "secret" },
    {
      type: "function_call",
      name: "save_lead",
      call_id: "call_1",
      arguments: "{\"name\":\"Sam\"}",
    },
    { type: "message", content: [{ type: "output_text", text: "Hello there." }] },
  ]);
  assert.equal(parsed.text, "Hello there.");
  assert.equal(parsed.calls.length, 1);
  assert.equal(parsed.calls[0]?.arguments.name, "Sam");
});

test("origins are limited to the live site and localhost", () => {
  const policy = originPolicyFrom("", true);
  assert.equal(isAllowedOrigin("https://drivingschoolsolutions.co.uk", policy), true);
  assert.equal(isAllowedOrigin("https://www.drivingschoolsolutions.co.uk", policy), true);
  assert.equal(isAllowedOrigin("http://drivingschoolsolutions.co.uk", policy), false);
  assert.equal(isAllowedOrigin("https://drivingschoolsolutions.co.uk.evil.com", policy), false);
  assert.equal(isAllowedOrigin("https://evil.com", policy), false);
  assert.equal(isAllowedOrigin("http://localhost:3000", policy), true);
  assert.equal(isAllowedOrigin("http://127.0.0.1:8080", policy), true);
  assert.equal(isAllowedOrigin(undefined, policy), false);
  assert.equal(isAllowedOrigin("null", policy), false);

  const locked = originPolicyFrom("https://staging.example.com", false);
  assert.equal(isAllowedOrigin("https://staging.example.com", locked), true);
  assert.equal(isAllowedOrigin("https://drivingschoolsolutions.co.uk", locked), false);
  assert.equal(isAllowedOrigin("http://localhost:10000", locked), false);
  assert.equal(isAllowedOrigin("https://staging.example.com/path", locked), false);
});

test("rate limit and card details stop a message before it is stored", async () => {
  const limiter = createRateLimiter([{ windowMs: 60_000, max: 2 }]);
  assert.equal(limiter.allow("1", 1_000).ok, true);
  assert.equal(limiter.allow("1", 1_100).ok, true);
  const blocked = limiter.allow("1", 1_200);
  assert.equal(blocked.ok, false);
  if (!blocked.ok) assert.ok(blocked.retryAfterSeconds >= 1);

  assert.equal(containsCardNumber("Please call 07900 111222"), false);
  assert.equal(containsCardNumber("My card is 4242 4242 4242 4242"), true);
  assert.equal(redactCardNumbers("card 4242424242424242 thanks"), "card [removed] thanks");
  assert.equal(bearerMatches("Bearer secret-token", "secret-token"), true);
  assert.equal(bearerMatches("Bearer other", "secret-token"), false);
  assert.equal(bearerMatches(undefined, "secret-token"), false);

  let called = false;
  const result = await handleMirraMessage(
    { message: "4242424242424242" },
    {
      complete: async () => {
        called = true;
        return { output: [] };
      },
      store: createConversationStore(),
    },
  );
  assert.equal(called, false);
  assert.equal(result.status, 400);
  assert.equal(result.body.error, "card_details");
  assert.match(result.body.reply, /card details/i);
});

test("a website enquiry is stored with Amber's leads and emailed on the same path", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mirra-leads-"));
  const previousDir = process.env.DATA_DIR;
  const previousHook = process.env.EMAIL_WEBHOOK_URL;
  const previousTo = process.env.NOTIFY_TO_EMAIL;
  const originalFetch = globalThis.fetch;
  const posted: Array<{ subject?: string; text?: string; record?: LeadRecord }> = [];
  process.env.DATA_DIR = dir;
  process.env.EMAIL_WEBHOOK_URL = "https://example.test/hook";
  process.env.NOTIFY_TO_EMAIL = "grant@example.com";
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    posted.push(JSON.parse(String(init?.body)) as { subject?: string; text?: string; record?: LeadRecord });
    return new Response("ok", { status: 202 });
  }) as typeof fetch;

  try {
    const phone: LeadRecord = {
      type: "lead",
      callId: "call_1",
      from: "sip:+447700900111@example",
      receivedAt: "2026-11-09T09:00:00.000Z",
      name: "Jane Smith",
      phone: "+447700900111",
      interest: "website",
    };
    await notifyGrant(phone);

    const saved = await saveMirraEnquiry({
      tool: "request_gbp_audit",
      conversationId: "11111111-1111-4111-8111-111111111111",
      now: new Date("2026-11-09T10:15:00.000Z"),
      args: {
        name: "Sam Taylor",
        business_name: "Sutton School of Motoring",
        business_type: "solo instructor",
        town: "Sutton",
        email: "sam@example.com",
        gbp_url: "https://maps.google.com/?cid=1",
        notes: "card 4242424242424242",
      },
    });
    assert.equal(saved.saved, true);

    const lines = (await fs.readFile(path.join(dir, "leads.jsonl"), "utf8")).trim().split("\n");
    assert.equal(lines.length, 1);
    const stored = JSON.parse(lines[0] ?? "{}") as LeadRecord;
    assert.equal(stored.source, "website_chat");
    assert.equal(stored.type, "gbp_audit");
    assert.equal(stored.business_type, "solo ADI");
    assert.equal(stored.notes, "card [removed]");
    assert.equal(stored.interest, "Google Business Profile audit");

    assert.equal(posted.length, 2);
    assert.equal(posted[0]?.subject, "Amber: new lead — Jane Smith");
    assert.match(posted[0]?.text ?? "", /Call ID: call_1/);
    assert.doesNotMatch(posted[0]?.text ?? "", /Source:/);
    assert.equal(posted[1]?.subject, "Mirra: Google Business Profile audit request from Sam Taylor");
    assert.match(posted[1]?.text ?? "", /Source: website chat/);
    assert.match(posted[1]?.text ?? "", /Type: GBP audit request/);
    assert.match(posted[1]?.text ?? "", /Town: Sutton/);
    assert.equal(posted[1]?.record?.source, "website_chat");

    const website = await listLeads({ source: "website_chat", dataDir: dir });
    assert.equal(website.length, 1);
    const audits = await listLeads({ type: "gbp_audit", since: "2026-11-09T10:00:00.000Z", dataDir: dir });
    assert.equal(audits.length, 1);
    const earlier = await listLeads({ since: "2026-11-09T11:00:00.000Z", dataDir: dir });
    assert.equal(earlier.length, 0);

    const again = await saveMirraEnquiry({
      tool: "request_gbp_audit",
      conversationId: "11111111-1111-4111-8111-111111111111",
      now: new Date("2026-11-09T10:16:00.000Z"),
      alreadySaved: new Set([saved.key ?? ""]),
      args: {
        name: "Sam Taylor",
        business_name: "Sutton School of Motoring",
        town: "Sutton",
        email: "sam@example.com",
        gbp_url: "https://maps.google.com/?cid=1",
      },
    });
    assert.equal(again.duplicate, true);
    const after = (await fs.readFile(path.join(dir, "leads.jsonl"), "utf8")).trim().split("\n");
    assert.equal(after.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv("DATA_DIR", previousDir);
    restoreEnv("EMAIL_WEBHOOK_URL", previousHook);
    restoreEnv("NOTIFY_TO_EMAIL", previousTo);
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("conversation length and invented prices never reach the visitor as fact", async () => {
  const store = createConversationStore();
  let calls = 0;
  const complete: Completer = async () => {
    calls += 1;
    return { output: [{ type: "message", content: "We can do it for £1,500." }] };
  };
  const first = await handleMirraMessage(
    { message: "How much for a huge site?" },
    { complete, store, maxUserTurns: 1 },
  );
  assert.equal(first.status, 200);
  assert.match(first.body.reply, /only quote the prices published/);
  assert.doesNotMatch(first.body.reply, /1,500/);

  const second = await handleMirraMessage(
    { message: "And another thing", conversationId: first.body.conversationId },
    { complete, store, maxUserTurns: 1 },
  );
  assert.equal(second.body.error, "length_limit");
  assert.equal(calls, 1);

  assert.equal(
    finalReply("The five-page website is £299.99 at the moment. 😊", []),
    "The five-page website is £299.99 at the moment.",
  );
});

test("the widget is one script, scoped, and the chat endpoint enforces origin and the lead read", async () => {
  const js = mirraWidgetJs({ maxMessageChars: 1500 });
  new Function(js);
  assert.match(js, /attachShadow\(\{ mode: "open" \}\)/);
  assert.match(js, /Urbanist/);
  assert.match(js, /#4786ee/);
  assert.match(js, /#ff7851/);
  assert.match(js, /#8559e6/);
  assert.match(js, /#0b3665/);
  assert.match(js, new RegExp(MIRRA_OPENING.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(js, /Chat with Mirra/);
  assert.match(js, /left: max\(16px, env\(safe-area-inset-left\)\)/);
  assert.match(js, /\.panel \{[^}]*left: 0;/);
  assert.doesNotMatch(js, /safe-area-inset-right/);
  assert.match(js, /class=\\"avatar\\"|class="avatar"/);
  assert.match(js, /mirra-blink/);
  assert.match(js, /mirra-breathe/);
  assert.match(js, /is-thinking/);
  assert.match(js, /prefers-reduced-motion: reduce/);
  assert.doesNotMatch(js, /M4 5h16a2 2 0 0 1 2 2v8/);
  assert.doesNotMatch(js, /\p{Extended_Pictographic}/u);
  assert.doesNotMatch(js, /Grant/);

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mirra-http-"));
  const previous = {
    DATA_DIR: process.env.DATA_DIR,
    LEADS_READ_TOKEN: process.env.LEADS_READ_TOKEN,
    EMAIL_WEBHOOK_URL: process.env.EMAIL_WEBHOOK_URL,
    SMTP_HOST: process.env.SMTP_HOST,
  };
  process.env.DATA_DIR = dir;
  process.env.LEADS_READ_TOKEN = "read-token";
  delete process.env.EMAIL_WEBHOOK_URL;
  delete process.env.SMTP_HOST;

  const store = createConversationStore();
  const complete: Completer = async (request) => {
    const last = request.input[request.input.length - 1] as { role?: string } | undefined;
    if (last && "type" in (last as object)) {
      return {
        output: [{ type: "message", content: "Thanks. A member of the team will call you then." }],
      };
    }
    return {
      output: [
        {
          type: "function_call",
          name: "book_callback",
          call_id: "cb_1",
          arguments: {
            name: "Sam Taylor",
            phone: "07900 111222",
            preferred_time: "Tomorrow morning",
            business_type: "driving school",
            school_or_area: "Sutton",
          },
        },
      ],
    };
  };

  const app = createApp({
    mirra: { complete, store, chatRules: [{ windowMs: 60_000, max: 20 }] },
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const base = `http://127.0.0.1:${port}`;

  try {
    const health = await fetch(`${base}/health`).then((res) => res.json() as Promise<{ chat?: string; ok?: boolean }>);
    assert.equal(health.ok, true);
    assert.equal(health.chat, "Mirra");

    const widget = await fetch(`${base}/mirra/widget.js`);
    assert.equal(widget.headers.get("content-type"), "application/javascript; charset=utf-8");
    assert.match(await widget.text(), /Mirra/);

    const denied = await fetch(`${base}/mirra/chat`, {
      method: "POST",
      headers: { Origin: "https://evil.example", "Content-Type": "application/json" },
      body: JSON.stringify({ message: "hello" }),
    });
    assert.equal(denied.status, 403);

    const booked = await fetch(`${base}/mirra/chat`, {
      method: "POST",
      headers: { Origin: "http://localhost:3000", "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Please book a callback for tomorrow morning." }),
    });
    assert.equal(booked.status, 200);
    assert.equal(booked.headers.get("access-control-allow-origin"), "http://localhost:3000");
    const bookedBody = (await booked.json()) as { reply: string };
    assert.match(bookedBody.reply, /member of the team/);

    const closed = await fetch(`${base}/mirra/leads`);
    assert.equal(closed.status, 401);
    const leads = await fetch(`${base}/mirra/leads?source=website_chat&type=callback`, {
      headers: { Authorization: "Bearer read-token" },
    });
    const leadBody = (await leads.json()) as { count: number; leads: LeadRecord[] };
    assert.equal(leads.status, 200);
    assert.equal(leadBody.count, 1);
    assert.equal(leadBody.leads[0]?.source, "website_chat");
    assert.equal(leadBody.leads[0]?.type, "callback");
    assert.equal(leadBody.leads[0]?.name, "Sam Taylor");

    const webhook = await fetch(`${base}/webhooks/xai/incoming`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    assert.equal(webhook.status, 401);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    restoreEnv("DATA_DIR", previous.DATA_DIR);
    restoreEnv("LEADS_READ_TOKEN", previous.LEADS_READ_TOKEN);
    restoreEnv("EMAIL_WEBHOOK_URL", previous.EMAIL_WEBHOOK_URL);
    restoreEnv("SMTP_HOST", previous.SMTP_HOST);
    await fs.rm(dir, { recursive: true, force: true });
  }
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
