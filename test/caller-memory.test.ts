import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { CALLER_NAMES_FILE, callerMemoryLine, lookupCallerMemory } from "../src/caller-memory.js";

async function withDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "amber-memory-"));
  try {
    await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test("uses the most recent real name across leads and call summaries", async () => {
  await withDir(async (dir) => {
    await fs.writeFile(
      path.join(dir, "leads.jsonl"),
      [
        JSON.stringify({
          type: "lead",
          name: "Old Name",
          phone: "07900 900687",
          receivedAt: "2026-01-01T12:00:00.000Z",
        }),
        JSON.stringify({
          type: "message",
          name: "transfer_to_grant",
          from: "<sip:+447900900687@host>",
          receivedAt: "2026-08-01T12:00:00.000Z",
        }),
        JSON.stringify({
          type: "lead",
          name: "Someone Else",
          phone: "+447911111111",
          receivedAt: "2026-11-01T12:00:00.000Z",
        }),
      ].join("\n") + "\n",
    );
    await fs.writeFile(
      path.join(dir, "calls.jsonl"),
      [
        JSON.stringify({
          type: "call_summary",
          callerName: "Jane Smith",
          callerNumber: "+447900900687",
          startedAt: "2026-10-02T15:00:00.000Z",
        }),
        JSON.stringify({
          type: "call_summary",
          callerNumber: "+447900900687",
          startedAt: "2026-11-01T15:00:00.000Z",
          tools: [{ arguments: { notes: "no name this time" } }],
        }),
      ].join("\n") + "\n",
    );

    const memory = await lookupCallerMemory("+447900900687", { dataDir: dir, timeoutMs: 2000 });
    assert.deepEqual(memory, { name: "Jane Smith", calledAt: "2026-10-02T15:00:00.000Z" });
    assert.equal(
      callerMemoryLine(memory!.name, new Date(memory!.calledAt)),
      'This number has called before as Jane Smith (last call 2 October 2026). Greet them warmly by name, e.g. "Hi Jane, nice to hear from you again", but check it is them, as someone else may be using the phone; if not, ask their name as normal. Do not reveal details of previous calls unless the caller confirms who they are.',
    );
  });
});

test("finds a name that sits before a large newer tail of other calls", async () => {
  await withDir(async (dir) => {
    const lines = [
      JSON.stringify({
        type: "lead",
        name: "Priya Shah",
        phone: "+447700900687",
        receivedAt: "2026-02-02T10:00:00.000Z",
      }),
    ];
    for (let i = 0; i < 800; i++) {
      lines.push(
        JSON.stringify({
          type: "lead",
          name: `Other ${i}`,
          phone: `+4478000${String(i).padStart(5, "0")}`,
          receivedAt: "2026-03-01T10:00:00.000Z",
        }),
      );
    }
    await fs.writeFile(path.join(dir, "leads.jsonl"), `${lines.join("\n")}\n`);
    const memory = await lookupCallerMemory("+447700900687", { dataDir: dir, timeoutMs: 2000 });
    assert.equal(memory?.name, "Priya Shah");
  });
});

test("caller-names.json can outlive the call that supplied the name", async () => {
  await withDir(async (dir) => {
    const lastHeard = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    await fs.writeFile(
      path.join(dir, "calls.jsonl"),
      `${JSON.stringify({
        type: "call_summary",
        callerName: "Old Name",
        callerNumber: "+447700900687",
        startedAt: "2026-01-01T12:00:00.000Z",
      })}\n`,
    );
    await fs.writeFile(
      path.join(dir, CALLER_NAMES_FILE),
      `${JSON.stringify({
        "+447700900687": { name: "Jane Smith", nameAt: "2026-01-01T12:00:00.000Z", lastHeardAt: lastHeard },
      })}\n`,
    );
    const memory = await lookupCallerMemory("+447700900687", { dataDir: dir, timeoutMs: 2000 });
    assert.deepEqual(memory, { name: "Jane Smith", calledAt: lastHeard });
  });
});

test("a newer named call beats an older caller-names entry", async () => {
  await withDir(async (dir) => {
    const older = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    const newer = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();
    await fs.writeFile(
      path.join(dir, CALLER_NAMES_FILE),
      `${JSON.stringify({
        "+447700900687": { name: "Jane Smith", nameAt: older, lastHeardAt: older },
      })}\n`,
    );
    await fs.writeFile(
      path.join(dir, "calls.jsonl"),
      `${JSON.stringify({
        type: "call_summary",
        callerName: "Bob Adeyemi",
        callerNumber: "+447700900687",
        startedAt: newer,
      })}\n`,
    );
    const memory = await lookupCallerMemory("+447700900687", { dataDir: dir, timeoutMs: 2000 });
    assert.equal(memory?.name, "Bob Adeyemi");
    assert.equal(memory?.calledAt, newer);
  });
});

test("an expired caller-names entry is ignored and a bad file does not throw", async () => {
  await withDir(async (dir) => {
    const expired = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
    await fs.writeFile(
      path.join(dir, CALLER_NAMES_FILE),
      `${JSON.stringify({
        "+447700900687": { name: "Jane Smith", nameAt: expired, lastHeardAt: expired },
      })}\n`,
    );
    assert.equal(await lookupCallerMemory("+447700900687", { dataDir: dir, timeoutMs: 2000 }), undefined);

    await fs.writeFile(path.join(dir, CALLER_NAMES_FILE), "{not json");
    assert.equal(await lookupCallerMemory("+447700900687", { dataDir: dir, timeoutMs: 2000 }), undefined);
  });
});

test("missing files and a slow lookup do not throw", async () => {
  await withDir(async (dir) => {
    assert.equal(await lookupCallerMemory("+447700900687", { dataDir: dir, timeoutMs: 500 }), undefined);
  });

  const started = Date.now();
  const slow = await lookupCallerMemory("+447700900687", {
    timeoutMs: 40,
    search: () => new Promise(() => undefined),
  });
  assert.equal(slow, undefined);
  assert.ok(Date.now() - started < 500);

  const failed = await lookupCallerMemory("+447700900687", {
    timeoutMs: 500,
    search: async () => {
      throw new Error("disk unavailable");
    },
  });
  assert.equal(failed, undefined);
});
