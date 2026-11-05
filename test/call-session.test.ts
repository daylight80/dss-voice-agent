import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import WebSocket from "ws";
import { AMBER_GREETING_HINT, AMBER_INSTRUCTIONS } from "../src/amber-prompt.js";
import { buildCallInstructions, buildGreetingInstructions } from "../src/call-context.js";
import { joinCall } from "../src/call-session.js";
import { config } from "../src/config.js";
import { AMBER_TOOLS } from "../src/tools.js";

type FakeSocket = {
  readyState: number;
  sent: string[];
  send: (data: string) => void;
  on: (event: string, listener: (...args: never[]) => void) => FakeSocket;
  emit: (event: string, ...args: unknown[]) => void;
};

function fakeSocket(): FakeSocket {
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  const socket: FakeSocket = {
    readyState: 1,
    sent: [],
    send(data: string) {
      socket.sent.push(data);
    },
    on(event, listener) {
      const list = listeners.get(event) ?? [];
      list.push(listener as (...args: unknown[]) => void);
      listeners.set(event, list);
      return socket;
    },
    emit(event, ...args) {
      for (const listener of listeners.get(event) ?? []) listener(...args);
    },
  };
  return socket;
}

function sentJson(socket: FakeSocket) {
  return socket.sent.map((raw) => JSON.parse(raw) as Record<string, unknown>);
}

async function flush(): Promise<void> {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

async function waitFor(pred: () => boolean): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > 2000) throw new Error("timed out");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

type EnvSnap = Record<string, string | undefined>;

function useEmailEnv(dataDir: string): () => void {
  const keys = ["DATA_DIR", "EMAIL_WEBHOOK_URL", "SMTP_HOST", "NOTIFY_TO_EMAIL", "NOTIFY_FROM_EMAIL", "XAI_API_KEY"];
  const prev: EnvSnap = {};
  for (const key of keys) prev[key] = process.env[key];
  process.env.DATA_DIR = dataDir;
  process.env.EMAIL_WEBHOOK_URL = "https://example.test/email";
  process.env.NOTIFY_TO_EMAIL = "grant@example.com";
  process.env.NOTIFY_FROM_EMAIL = "amber@drivingschoolsolutions.co.uk";
  process.env.XAI_API_KEY = "xai-test";
  delete process.env.SMTP_HOST;
  return () => {
    for (const key of keys) {
      if (prev[key] === undefined) delete process.env[key];
      else process.env[key] = prev[key];
    }
  };
}

test("per-call instructions confirm the number and remember a name without editing the base prompt", () => {
  assert.equal(buildCallInstructions({}), AMBER_INSTRUCTIONS);
  assert.equal(AMBER_INSTRUCTIONS.includes("ringing from"), false);

  const withNumber = buildCallInstructions({ callerNumber: "+447700900687" });
  assert.ok(withNumber.startsWith(AMBER_INSTRUCTIONS));
  assert.match(withNumber, /ending 687/);
  assert.equal(AMBER_INSTRUCTIONS.includes("ending 687"), false);

  const at = new Date("2026-11-05T13:03:00.000Z");
  assert.equal(buildGreetingInstructions(undefined, at), AMBER_GREETING_HINT(at));
  const named = buildGreetingInstructions({ name: "Jane Smith", calledAt: "2026-10-02T15:00:00.000Z" }, at);
  assert.match(
    named,
    /Good Afternoon\. Thank you for calling Driving School Solutions, Amber speaking\. Just so you know calls are recorded and transcribed for quality and training\. Hi Jane, nice to hear from you again\. How may I assist you today\?/,
  );
  assert.match(buildCallInstructions({
    callerNumber: "+447700900687",
    memory: { name: "Jane Smith", calledAt: "2026-10-02T15:00:00.000Z" },
  }), /Do not reveal details of previous calls/);
});

test("the greeting is not held for caller memory, and a known name is applied when it is ready", async () => {
  const ws = fakeSocket();
  let connections = 0;
  const greetingAt = new Date("2026-11-05T13:03:00.000Z");
  const meta = { callId: "call-memory-slow", from: "<sip:+447700900687@pstn.twilio.com>" };
  let resolveMemory: (value: { name: string; calledAt: string } | undefined) => void = () => undefined;
  const pending = new Promise<{ name: string; calledAt: string } | undefined>((resolve) => {
    resolveMemory = resolve;
  });

  joinCall(meta, {
    connect: () => {
      connections += 1;
      return ws as unknown as WebSocket;
    },
    now: () => greetingAt,
    lookupMemory: () => pending,
  });
  joinCall(meta, {
    connect: () => {
      connections += 1;
      return fakeSocket() as unknown as WebSocket;
    },
  });
  assert.equal(connections, 1);

  ws.emit("open");
  const opened = sentJson(ws);
  assert.equal(opened.length, 2);
  const session = opened[0].session as { voice: string; instructions: string; tools: Array<{ name: string }> };
  assert.equal(session.voice, config.voice);
  assert.ok(session.instructions.startsWith(AMBER_INSTRUCTIONS));
  assert.match(session.instructions, /ringing from \+447700900687/);
  assert.equal(session.instructions.includes("nice to hear from you again"), false);
  assert.deepEqual(session.tools.map((tool) => tool.name), AMBER_TOOLS.map((tool) => tool.name));
  const audio = (opened[0].session as { audio: { input: { transcription: { model: string } } } }).audio;
  assert.equal(audio.input.transcription.model, "grok-transcribe");
  const greeting = opened[1].response as { instructions: string };
  assert.equal(greeting.instructions, AMBER_GREETING_HINT(greetingAt));

  resolveMemory({ name: "Jane Smith", calledAt: "2026-10-02T15:00:00.000Z" });
  await flush();
  const after = sentJson(ws);
  assert.equal(after.filter((event) => event.type === "response.create").length, 1);
  const followUp = after.at(-1);
  assert.equal(followUp?.type, "session.update");
  const followInstructions = (followUp?.session as { instructions: string }).instructions;
  assert.match(followInstructions, /Hi Jane, nice to hear from you again/);
  assert.match(followInstructions, /ringing from \+447700900687/);
  assert.equal((followUp?.session as { voice?: string }).voice, undefined);

  const ready = fakeSocket();
  joinCall(
    { callId: "call-memory-ready", from: meta.from },
    {
      connect: () => ready as unknown as WebSocket,
      now: () => new Date("2026-11-05T13:03:00.000Z"),
      lookupMemory: async () => ({ name: "Jane Smith", calledAt: "2026-10-02T15:00:00.000Z" }),
    },
  );
  await flush();
  ready.emit("open");
  const readySent = sentJson(ready);
  const readyGreeting = readySent[1].response as { instructions: string };
  assert.match(readyGreeting.instructions, /Hi Jane, nice to hear from you again/);
  assert.equal(readySent.filter((event) => event.type === "response.create").length, 1);
});

test("withheld callers keep the exact greeting and prompt", () => {
  const ws = fakeSocket();
  const at = new Date("2026-11-05T13:03:00.000Z");
  joinCall(
    { callId: "call-withheld", from: '"Anonymous" <sip:anonymous@anonymous.invalid>' },
    { connect: () => ws as unknown as WebSocket, now: () => at },
  );
  ws.emit("open");
  const sent = sentJson(ws);
  const session = sent[0].session as { instructions: string; voice: string };
  assert.equal(session.instructions, AMBER_INSTRUCTIONS);
  assert.equal(session.voice, config.voice);
  assert.equal((sent[1].response as { instructions: string }).instructions, AMBER_GREETING_HINT(at));
});

test("every call is summarised once, tools still email, and the caller number is used", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "amber-call-"));
  const restore = useEmailEnv(dir);
  const posts: Array<{ url: string; body: Record<string, unknown> }> = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    posts.push({ url, body });
    if (url.includes("api.x.ai")) {
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content:
                  "Jane Smith rang about a website for her driving school in Sutton and booked a callback for tomorrow morning.",
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return new Response("ok", { status: 200 });
  }) as typeof fetch;

  try {
    const ws = fakeSocket();
    const times = [new Date("2026-11-05T13:03:00.000Z"), new Date("2026-11-05T13:04:20.000Z")];
    let tick = 0;
    joinCall(
      { callId: "call_123", from: "<sip:+447700900687@pstn.twilio.com>;tag=1", to: "<sip:+442081941993@sip.voice.x.ai>" },
      {
        connect: () => ws as unknown as WebSocket,
        now: () => times[Math.min(tick++, times.length - 1)],
        lookupMemory: async () => undefined,
      },
    );
    ws.emit("open");
    ws.emit(
      "message",
      Buffer.from(
        JSON.stringify({
          type: "response.output_audio_transcript.done",
          item_id: "a1",
          transcript:
            "Good Afternoon. Thank you for calling Driving School Solutions, Amber speaking. How may I assist you?",
        }),
      ),
    );
    ws.emit(
      "message",
      Buffer.from(
        JSON.stringify({
          type: "conversation.item.input_audio_transcription.completed",
          item_id: "u1",
          transcript: "I'd like a website for my driving school, please.",
        }),
      ),
    );
    ws.emit(
      "message",
      Buffer.from(
        JSON.stringify({
          type: "response.function_call_arguments.done",
          call_id: "tool-1",
          name: "book_callback",
          arguments: JSON.stringify({ name: "Jane Smith", preferred_time: "Tomorrow morning" }),
        }),
      ),
    );
    ws.emit("close", 1000, Buffer.from(""));
    ws.emit("close", 1000, Buffer.from(""));

    await waitFor(() => posts.filter((post) => String(post.body.subject ?? "").startsWith("Amber call summary:")).length === 1);
    await new Promise((resolve) => setTimeout(resolve, 30));

    const summaries = posts.filter((post) => String(post.body.subject ?? "").startsWith("Amber call summary:"));
    assert.equal(summaries.length, 1);
    assert.equal(summaries[0].url, "https://example.test/email");
    assert.equal(summaries[0].body.to, "grant@example.com");
    assert.equal(summaries[0].body.subject, "Amber call summary: +447700900687 at 13:03");
    const text = String(summaries[0].body.text);
    assert.match(text, /Outcome: Callback booked/);
    assert.match(text, /Name: Jane Smith/);
    assert.match(text, /Phone: \+447700900687/);
    assert.match(text, /Caller: I'd like a website/);
    assert.match(text, /Amber: Good Afternoon/);
    assert.match(text, /Duration: 1 minute 20 seconds/);

    const toolMails = posts.filter((post) => String(post.body.subject ?? "").startsWith("Amber: callback request"));
    assert.equal(toolMails.length, 1);
    assert.match(String(toolMails[0].body.text), /Phone: \+447700900687/);

    const calls = (await fs.readFile(path.join(dir, "calls.jsonl"), "utf8")).trim().split("\n");
    assert.equal(calls.length, 1);
    const saved = JSON.parse(calls[0]) as { callerName?: string; callerNumber?: string; type?: string };
    assert.equal(saved.type, "call_summary");
    assert.equal(saved.callerName, "Jane Smith");
    assert.equal(saved.callerNumber, "+447700900687");

    const leads = JSON.parse((await fs.readFile(path.join(dir, "leads.jsonl"), "utf8")).trim()) as { phone?: string };
    assert.equal(leads.phone, "+447700900687");

    const again = fakeSocket();
    let lateConnections = 0;
    joinCall(
      { callId: "call_123", from: "<sip:+447700900687@pstn.twilio.com>" },
      {
        connect: () => {
          lateConnections += 1;
          return again as unknown as WebSocket;
        },
      },
    );
    assert.equal(lateConnections, 0);
  } finally {
    globalThis.fetch = original;
    restore();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("a caller who says nothing still produces one summary email", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "amber-silent-"));
  const restore = useEmailEnv(dir);
  const posts: Array<Record<string, unknown>> = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    posts.push(init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {});
    return new Response("ok", { status: 200 });
  }) as typeof fetch;

  try {
    const ws = fakeSocket();
    joinCall(
      { callId: "call-silent", from: '"Anonymous" <sip:anonymous@anonymous.invalid>' },
      {
        connect: () => ws as unknown as WebSocket,
        now: () => new Date("2026-11-05T13:03:00.000Z"),
      },
    );
    ws.emit("open");
    ws.emit("close", 1000, Buffer.from("caller gone"));
    await waitFor(() => posts.length === 1);
    assert.equal(posts[0].subject, "Amber call summary: unknown number at 13:03");
    assert.match(String(posts[0].text), /No speech was captured/);
    assert.match(String(posts[0].text), /Outcome: None/);
    const saved = JSON.parse(await fs.readFile(path.join(dir, "calls.jsonl"), "utf8")) as { summarySource?: string };
    assert.equal(saved.summarySource, "fallback");
  } finally {
    globalThis.fetch = original;
    restore();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
