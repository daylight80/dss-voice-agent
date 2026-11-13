import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { mentionsUnknownAdiPrice } from "../src/adi-facts.js";
import { saveAdiEnquiry } from "../src/adi-enquiry.js";
import { ADI_OPENING, adiGuardReply, adiInstructions } from "../src/adi-prompt.js";
import { adiWidgetJs } from "../src/adi-widget.js";
import { createApp } from "../src/index.js";
import { createConversationStore, handleMirraMessage } from "../src/mirra-chat.js";
import { isAllowedOrigin, originPolicyFrom } from "../src/mirra-guard.js";
import { mirraWidgetJs } from "../src/mirra-widget.js";
import { buildXaiBody, type Completer } from "../src/mirra-xai.js";
import { FORMULA_JON_ORIGINS } from "../src/adi-routes.js";
import type { LeadRecord } from "../src/notify.js";

test("Mirra's widget is unchanged by ADI's colours and name", () => {
  const js = mirraWidgetJs();
  assert.match(js, /Urbanist/);
  assert.match(js, /#4786ee/);
  assert.match(js, /#ff7851/);
  assert.match(js, /#8559e6/);
  assert.match(js, /#0b3665/);
  assert.match(js, /Hi, I'm Mirra\. How can I help you\?/);
  assert.doesNotMatch(js, /Formula Jon/);
  assert.doesNotMatch(js, /#E01609/);
  assert.doesNotMatch(js, /is-pleased/);
  assert.doesNotMatch(js, /smile-big/);
  assert.doesNotMatch(js, /Raleway/);
});

test("ADI quotes Formula Jon only, and refuses a price that is not on the site", () => {
  const instructions = adiInstructions(new Date("2026-11-13T10:00:00.000Z"));
  assert.match(instructions, /You are ADI/);
  assert.match(instructions, /Say "pupils"/);
  assert.match(instructions, new RegExp(ADI_OPENING.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(instructions, /£39 an hour/);
  assert.match(instructions, /£40 an hour/);
  assert.match(instructions, /07790 779 687/);
  assert.match(instructions, /0330 043 6002/);
  assert.match(instructions, /https:\/\/www\.formulajondrivingschool\.co\.uk\/book/);
  assert.match(instructions, /ready to check lesson availability/);
  assert.match(instructions, /one or two at a time/);
  const availability = instructions.slice(instructions.indexOf("1) Name"), instructions.indexOf("If they would rather not"));
  assert.match(availability, /1\) Name[\s\S]*2\) Phone number[\s\S]*3\) Pickup postcode[\s\S]*4\) Lesson availability[\s\S]*5\) Theory test passed/);
  assert.doesNotMatch(instructions, /£299\.99/);
  assert.doesNotMatch(instructions, /Driving School Solutions/);
  assert.doesNotMatch(instructions, /Grant/);

  assert.equal(mentionsUnknownAdiPrice("Lessons in Sutton are £39 an hour."), false);
  assert.equal(mentionsUnknownAdiPrice("A 10-hour block is £380, which is £38 an hour."), false);
  assert.equal(mentionsUnknownAdiPrice("Motorway lessons are £97.50."), false);
  assert.equal(mentionsUnknownAdiPrice("The theory page says £23."), false);
  assert.equal(mentionsUnknownAdiPrice("That would be £1,500."), true);
  assert.equal(mentionsUnknownAdiPrice("It is £50 an hour."), true);
  assert.equal(mentionsUnknownAdiPrice("It is $39."), true);

  assert.match(adiGuardReply("We can do a special for £50.", []), /only quote the prices published/);
  assert.equal(
    adiGuardReply("Sutton is £39 an hour. 😊", []),
    "Sutton is £39 an hour.",
  );
});

test("ADI's widget is its own embed, with the cap and the site colours", () => {
  const js = adiWidgetJs({ maxMessageChars: 1500 });
  new Function(js);
  assert.match(js, /attachShadow\(\{ mode: "open" \}\)/);
  assert.match(js, /Raleway/);
  assert.match(js, /Roboto/);
  assert.match(js, /#E01609/);
  assert.match(js, /#191825/);
  assert.match(js, /#F7F7F7/);
  assert.match(js, /#ECEBD7/);
  assert.match(js, /#54595F/);
  assert.match(js, new RegExp(ADI_OPENING.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(js, /Chat with ADI/);
  assert.match(js, /\/adi\/widget\.js/);
  assert.match(js, /\/adi\/chat/);
  assert.match(js, /left: max\(16px, env\(safe-area-inset-left\)\)/);
  assert.match(js, /\.panel \{[^}]*left: 0;/);
  assert.match(js, /adi-blink/);
  assert.match(js, /adi-breathe/);
  assert.match(js, /prefers-reduced-motion: reduce/);
  assert.match(js, /3000 \+ Math\.random\(\) \* 3000/);
  assert.match(js, /is-blinking/);
  assert.match(js, /is-pleased/);
  assert.match(js, /smile-big/);
  assert.match(js, /smile-rest/);
  assert.match(js, /launcher:hover \.smile-big/);
  assert.match(js, /class=\\"bobble|class="bobble"/);
  assert.match(js, /beanie-band/);
  assert.doesNotMatch(js, /class=\\"peak|class="peak"/);
  assert.doesNotMatch(js, /Urbanist/);
  assert.doesNotMatch(js, /Grant/);
  assert.doesNotMatch(js, /\p{Extended_Pictographic}/u);
});

test("ADI enquiries are stored apart from Mirra and emailed with the ADI subject", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "adi-leads-"));
  const previous = {
    DATA_DIR: process.env.DATA_DIR,
    EMAIL_WEBHOOK_URL: process.env.EMAIL_WEBHOOK_URL,
    NOTIFY_TO_EMAIL: process.env.NOTIFY_TO_EMAIL,
    ADI_NOTIFY_TO_EMAIL: process.env.ADI_NOTIFY_TO_EMAIL,
    ADI_NOTIFY_BCC_EMAIL: process.env.ADI_NOTIFY_BCC_EMAIL,
  };
  process.env.DATA_DIR = dir;
  process.env.EMAIL_WEBHOOK_URL = "https://example.test/hook";
  process.env.NOTIFY_TO_EMAIL = "grant@example.com";
  delete process.env.ADI_NOTIFY_TO_EMAIL;
  delete process.env.ADI_NOTIFY_BCC_EMAIL;
  const posted: Array<{ to?: string; bcc?: string; subject?: string; text?: string; record?: LeadRecord }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    posted.push(JSON.parse(String(init?.body)) as { to?: string; bcc?: string; subject?: string; text?: string; record?: LeadRecord });
    return new Response("ok", { status: 202 });
  }) as typeof fetch;

  try {
    const saved = await saveAdiEnquiry({
      tool: "book_callback",
      conversationId: "22222222-2222-4222-8222-222222222222",
      now: new Date("2026-11-13T10:15:00.000Z"),
      args: {
        name: "Sam Taylor",
        phone: "07790 111222",
        area: "Carshalton",
        transmission: "Automatic",
        preferred_time: "Saturday morning",
      },
    });
    assert.equal(saved.saved, true);

    const stored = JSON.parse((await fs.readFile(path.join(dir, "leads.jsonl"), "utf8")).trim()) as LeadRecord;
    assert.equal(stored.client, "adi");
    assert.equal(stored.source, "website_chat");
    assert.equal(stored.type, "callback");
    assert.equal(stored.transmission, "automatic");
    assert.equal(stored.school_or_area, "Carshalton");

    assert.equal(posted.length, 1);
    assert.equal(posted[0]?.to, "info@formulajondrivingschool.co.uk");
    assert.equal(posted[0]?.bcc, "grant@example.com");
    assert.equal(posted[0]?.subject, "ADI (Formula Jon): callback request from Sam Taylor");
    assert.match(posted[0]?.text ?? "", /Area: Carshalton/);
    assert.match(posted[0]?.text ?? "", /Manual or automatic: automatic/);
    assert.match(posted[0]?.text ?? "", /ADI, Formula Jon/);

    process.env.ADI_NOTIFY_TO_EMAIL = "jon@example.com";
    process.env.ADI_NOTIFY_BCC_EMAIL = "office@example.com";
    posted.length = 0;
    const redirected = await saveAdiEnquiry({
      tool: "leave_message",
      conversationId: "22222222-2222-4222-8222-222222222222",
      now: new Date("2026-11-13T10:20:00.000Z"),
      args: {
        name: "Sam Taylor",
        email: "sam@example.com",
        message: "Please call about a refresher.",
      },
    });
    assert.equal(redirected.saved, true);
    assert.equal(posted[0]?.to, "jon@example.com");
    assert.equal(posted[0]?.bcc, "office@example.com");
    assert.equal(posted[0]?.subject, "ADI (Formula Jon): message from Sam Taylor");

    posted.length = 0;
    const partial = await saveAdiEnquiry({
      tool: "save_lead",
      conversationId: "22222222-2222-4222-8222-222222222222",
      now: new Date("2026-11-13T10:25:00.000Z"),
      args: { name: "Sam Taylor", phone: "07790 111222" },
    });
    assert.equal(partial.saved, true);
    assert.match(posted[0]?.text ?? "", /Name: Sam Taylor/);
    assert.match(posted[0]?.text ?? "", /Phone number: 07790 111222/);
    assert.doesNotMatch(posted[0]?.text ?? "", /Pickup postcode/);

    posted.length = 0;
    const full = await saveAdiEnquiry({
      tool: "save_lead",
      conversationId: "33333333-3333-4333-8333-333333333333",
      now: new Date("2026-11-13T10:30:00.000Z"),
      args: {
        name: "Alex Patel",
        phone: "07790 333444",
        pickup_postcode: "SM5 4NQ",
        lesson_availability: "Weekday evenings after 6",
        theory_passed: "not yet",
      },
    });
    assert.equal(full.saved, true);
    const line = (await fs.readFile(path.join(dir, "leads.jsonl"), "utf8")).trim().split("\n").at(-1);
    const storedFull = JSON.parse(line ?? "{}") as LeadRecord;
    assert.deepEqual(
      storedFull.details?.map((detail) => detail.label),
      ["Name", "Phone number", "Pickup postcode", "Lesson availability", "Theory test passed"],
    );
    assert.equal(storedFull.details?.find((detail) => detail.key === "theory_passed")?.value, "No");
    assert.equal(storedFull.school_or_area, "SM5 4NQ");
    const email = posted[0]?.text ?? "";
    assert.match(email, /Name: Alex Patel/);
    assert.match(email, /Phone number: 07790 333444/);
    assert.match(email, /Pickup postcode: SM5 4NQ/);
    assert.match(email, /Lesson availability: Weekday evenings after 6/);
    assert.match(email, /Theory test passed: No/);
    assert.equal(posted[0]?.to, "jon@example.com");
    assert.equal(posted[0]?.bcc, "office@example.com");
    const nameAt = email.indexOf("Name:");
    const phoneAt = email.indexOf("Phone number:");
    const postcodeAt = email.indexOf("Pickup postcode:");
    const whenAt = email.indexOf("Lesson availability:");
    const theoryAt = email.indexOf("Theory test passed:");
    assert.ok(nameAt < phoneAt && phoneAt < postcodeAt && postcodeAt < whenAt && whenAt < theoryAt);

    const empty = await saveAdiEnquiry({
      tool: "save_lead",
      conversationId: "33333333-3333-4333-8333-333333333333",
      args: {},
    });
    assert.equal(empty.saved, false);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv(previous);
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("ADI's origins, tools and lead list stay off Mirra's", async () => {
  const policy = originPolicyFrom("", true, FORMULA_JON_ORIGINS);
  assert.equal(isAllowedOrigin("https://www.formulajondrivingschool.co.uk", policy), true);
  assert.equal(isAllowedOrigin("https://formulajondrivingschool.co.uk", policy), true);
  assert.equal(isAllowedOrigin("https://drivingschoolsolutions.co.uk", policy), false);
  assert.equal(isAllowedOrigin("http://localhost:10000", policy), true);

  const body = buildXaiBody({
    model: "grok-4.7",
    effort: "low",
    instructions: "facts",
    input: [],
    conversationId: "adi-1",
    tools: [{ type: "function", name: "book_callback" }],
  });
  assert.equal(JSON.stringify(body).includes("request_gbp_audit"), false);
  assert.equal(JSON.stringify(body).includes("book_callback"), true);

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "adi-http-"));
  const previous = {
    DATA_DIR: process.env.DATA_DIR,
    LEADS_READ_TOKEN: process.env.LEADS_READ_TOKEN,
    EMAIL_WEBHOOK_URL: process.env.EMAIL_WEBHOOK_URL,
    SMTP_HOST: process.env.SMTP_HOST,
    NOTIFY_TO_EMAIL: process.env.NOTIFY_TO_EMAIL,
  };
  process.env.DATA_DIR = dir;
  process.env.LEADS_READ_TOKEN = "read-token";
  process.env.NOTIFY_TO_EMAIL = "grant@example.com";
  delete process.env.EMAIL_WEBHOOK_URL;
  delete process.env.SMTP_HOST;

  const store = createConversationStore();
  const complete: Completer = async (request) => {
    assert.match(request.instructions, /Formula Jon/);
    assert.equal(JSON.stringify(request.tools).includes("request_gbp_audit"), false);
    const last = request.input[request.input.length - 1] as { role?: string } | undefined;
    if (last && "type" in (last as object)) {
      return { output: [{ type: "message", content: "Sutton lessons are £39 an hour." }] };
    }
    return {
      output: [
        {
          type: "function_call",
          name: "save_lead",
          call_id: "lead_1",
          arguments: {
            name: "Alex Patel",
            phone: "07790 111222",
            area: "Sutton",
            transmission: "manual",
            interest: "Beginner lessons",
          },
        },
      ],
    };
  };

  const app = createApp({
    adi: { complete, store, chatRules: [{ windowMs: 60_000, max: 20 }] },
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const base = `http://127.0.0.1:${port}`;

  try {
    const health = await fetch(`${base}/health`).then(
      (res) => res.json() as Promise<{ chat?: string; chats?: string[] }>,
    );
    assert.equal(health.chat, "Mirra");
    assert.deepEqual(health.chats, ["Mirra", "ADI"]);

    const preview = await fetch(`${base}/adi/preview`);
    assert.equal(preview.status, 200);
    const html = await preview.text();
    assert.match(html, /\/adi\/widget\.js/);
    assert.match(html, /#E01609/);
    assert.match(html, /Raleway/);
    assert.match(html, /not the live Formula Jon website/);

    const widget = await fetch(`${base}/adi/widget.js`);
    assert.equal(widget.headers.get("content-type"), "application/javascript; charset=utf-8");
    assert.match(await widget.text(), /Chat with ADI/);

    const wrongSite = await fetch(`${base}/adi/chat`, {
      method: "POST",
      headers: { Origin: "https://drivingschoolsolutions.co.uk", "Content-Type": "application/json" },
      body: JSON.stringify({ message: "How much is a lesson?" }),
    });
    assert.equal(wrongSite.status, 403);

    const booked = await fetch(`${base}/adi/chat`, {
      method: "POST",
      headers: { Origin: "http://127.0.0.1:10000", "Content-Type": "application/json" },
      body: JSON.stringify({ message: "I'd like lessons in Sutton." }),
    });
    assert.equal(booked.status, 200);
    const bookedBody = (await booked.json()) as { reply: string };
    assert.match(bookedBody.reply, /£39/);

    const mirraLeads = await fetch(`${base}/mirra/leads?source=website_chat`, {
      headers: { Authorization: "Bearer read-token" },
    });
    const mirraBody = (await mirraLeads.json()) as { count: number };
    assert.equal(mirraBody.count, 0);

    const adiLeads = await fetch(`${base}/adi/leads`, {
      headers: { Authorization: "Bearer read-token" },
    });
    const adiBody = (await adiLeads.json()) as { count: number; leads: LeadRecord[] };
    assert.equal(adiBody.count, 1);
    assert.equal(adiBody.leads[0]?.client, "adi");
    assert.equal(adiBody.leads[0]?.name, "Alex Patel");
    assert.equal(adiBody.leads[0]?.transmission, "manual");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    restoreEnv(previous);
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("an invented ADI price never reaches the visitor", async () => {
  const store = createConversationStore();
  const complete: Completer = async () => ({
    output: [{ type: "message", content: "We can do it for £1,500." }],
  });
  const result = await handleMirraMessage(
    { message: "How much for a private course?" },
    {
      complete,
      store,
      persona: {
        instructions: adiInstructions,
        saveEnquiry: saveAdiEnquiry,
        guardReply: adiGuardReply,
        cardRefusal: () => "no card",
        lengthLimitMessage: () => "too long",
      },
    },
  );
  assert.match(result.body.reply, /only quote the prices published/);
  assert.doesNotMatch(result.body.reply, /1,500/);
});

function restoreEnv(previous: Record<string, string | undefined>): void {
  for (const [name, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}
