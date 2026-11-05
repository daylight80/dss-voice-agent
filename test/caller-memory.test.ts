import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { callerMemoryLine, lookupCallerMemory } from "../src/caller-memory.js";

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

test("a newer lead that includes postcode and theory status still supplies the name", async () => {
  await withDir(async (dir) => {
    await fs.writeFile(
      path.join(dir, "leads.jsonl"),
      [
        JSON.stringify({
          type: "lead",
          name: "Old Name",
          phone: "+447700900687",
          receivedAt: "2026-01-01T12:00:00.000Z",
        }),
        JSON.stringify({
          type: "lead",
          name: "Sam Taylor",
          phone: "+447700900687",
          postcode: "SM5 2AB",
          theory_test_status: "Passed",
          receivedAt: "2026-11-04T12:00:00.000Z",
        }),
      ].join("\n") + "\n",
    );
    const memory = await lookupCallerMemory("+447700900687", { dataDir: dir, timeoutMs: 2000 });
    assert.equal(memory?.name, "Sam Taylor");
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
