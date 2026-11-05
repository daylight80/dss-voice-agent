import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { CALLER_NAMES_FILE, lookupCallerMemory } from "../src/caller-memory.js";
import { config, parseRetentionDays } from "../src/config.js";
import { persistCallRecord } from "../src/notify.js";
import {
  purgePersonalData,
  startPersonalDataRetention,
  type PurgeResult,
} from "../src/retention.js";

const DAY = 24 * 60 * 60 * 1000;
const NUMBER = "+447700900687";
const NAME = "Jane Smith";

async function withDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "amber-retention-"));
  try {
    await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

function ago(now: Date, days: number, extraMs = 0): string {
  return new Date(now.getTime() - days * DAY - extraMs).toISOString();
}

async function writeJsonl(dir: string, file: string, records: unknown[]): Promise<void> {
  const body = records.length ? `${records.map((record) => JSON.stringify(record)).join("\n")}\n` : "";
  await fs.writeFile(path.join(dir, file), body);
}

async function readText(dir: string, file: string): Promise<string> {
  try {
    return await fs.readFile(path.join(dir, file), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw err;
  }
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

async function capture(fn: () => Promise<PurgeResult>): Promise<{ result: PurgeResult; log: string }> {
  const lines: string[] = [];
  const log = console.log;
  const err = console.error;
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  console.error = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  try {
    const result = await fn();
    return { result, log: lines.join("\n") };
  } finally {
    console.log = log;
    console.error = err;
  }
}

function emptyResult(): PurgeResult {
  return {
    callsPurged: 0,
    leadsPurged: 0,
    namesPurged: 0,
    timestampsBackfilled: 0,
    unreadablePurged: 0,
    tempFilesRemoved: 0,
    otherFiles: 0,
  };
}

test("parseRetentionDays defaults to 30 and rejects invalid values", () => {
  assert.equal(parseRetentionDays(undefined), 30);
  assert.equal(parseRetentionDays("  "), 30);
  assert.equal(parseRetentionDays("nope"), 30);
  assert.equal(parseRetentionDays("-1"), 30);
  assert.equal(parseRetentionDays("0"), 0);
  assert.equal(parseRetentionDays(" 14 "), 14);
  assert.equal(parseRetentionDays("30.5"), 30.5);

  const prev = process.env.DATA_RETENTION_DAYS;
  try {
    delete process.env.DATA_RETENTION_DAYS;
    assert.equal(config.dataRetentionDays, 30);
    process.env.DATA_RETENTION_DAYS = "45";
    assert.equal(config.dataRetentionDays, 45);
    process.env.DATA_RETENTION_DAYS = "-5";
    assert.equal(config.dataRetentionDays, 30);
  } finally {
    if (prev === undefined) delete process.env.DATA_RETENTION_DAYS;
    else process.env.DATA_RETENTION_DAYS = prev;
  }
});

test("a missing or empty store does not throw or get created", async () => {
  const missing = path.join(os.tmpdir(), `amber-missing-${process.pid}-${Date.now()}`);
  const missingRun = await capture(() => purgePersonalData({ dataDir: missing, now: new Date() }));
  assert.deepEqual(missingRun.result, emptyResult());
  assert.equal(await exists(missing), false);
  assert.match(missingRun.log, /purged 0 call records, 0 lead records, 0 caller names/);
  assert.equal(missingRun.log.includes(missing), false);

  await withDir(async (dir) => {
    await writeJsonl(dir, "calls.jsonl", []);
    await writeJsonl(dir, "leads.jsonl", []);
    const result = await purgePersonalData({ dataDir: dir, now: new Date() });
    assert.equal(result.callsPurged, 0);
    assert.equal(result.leadsPurged, 0);
  });
});

test("records older than the period are deleted and a record at the boundary is kept", async () => {
  await withDir(async (dir) => {
    const now = new Date("2026-11-05T12:00:00.000Z");
    await writeJsonl(dir, "calls.jsonl", [
      { type: "call_summary", callId: "old", callerNumber: "+447700900001", startedAt: ago(now, 30, 1), transcript: "too old" },
      { type: "call_summary", callId: "edge", callerNumber: "+447700900002", startedAt: ago(now, 30), transcript: "exactly 30 days" },
    ]);
    await writeJsonl(dir, "leads.jsonl", [
      { type: "lead", phone: "+447700900003", email: "old@example.com", receivedAt: ago(now, 31), message: "old lead" },
      { type: "callback", phone: "+447700900004", email: "new@example.com", receivedAt: ago(now, 1), message: "new lead" },
    ]);

    const { result, log } = await capture(() => purgePersonalData({ dataDir: dir, now, retentionDays: 30 }));
    assert.equal(result.callsPurged, 1);
    assert.equal(result.leadsPurged, 1);
    assert.equal(result.namesPurged, 0);
    const calls = await readText(dir, "calls.jsonl");
    const leads = await readText(dir, "leads.jsonl");
    assert.equal(calls.includes("too old"), false);
    assert.equal(calls.includes("exactly 30 days"), true);
    assert.equal(leads.includes("old@example.com"), false);
    assert.equal(leads.includes("new@example.com"), true);
    assert.equal(log.includes("+447700900001"), false);
    assert.equal(log.includes("old@example.com"), false);
    assert.match(log, /purged 1 call records, 1 lead records, 0 caller names \(retention 30 days\)/);
  });
});

test("a caller name follows the last call, and the transcript does not", async () => {
  await withDir(async (dir) => {
    const now = new Date();
    const namedAt = ago(now, 40);
    const heardAt = ago(now, 5);
    await writeJsonl(dir, "calls.jsonl", [
      {
        type: "call_summary",
        callerName: NAME,
        callerNumber: NUMBER,
        startedAt: namedAt,
        endedAt: namedAt,
        summary: "Jane asked about a website",
        transcript: "secret transcript about Sutton",
      },
      {
        type: "call_summary",
        callerNumber: NUMBER,
        startedAt: heardAt,
        transcript: "recent call with no name",
      },
    ]);
    await writeJsonl(dir, "leads.jsonl", [
      {
        type: "lead",
        phone: "07900 900687",
        email: "zelda@example.com",
        receivedAt: ago(now, 50),
        message: "please ring",
      },
    ]);

    const first = await capture(() => purgePersonalData({ dataDir: dir, now, retentionDays: 30 }));
    assert.equal(first.result.callsPurged, 1);
    assert.equal(first.result.leadsPurged, 1);
    const calls = await readText(dir, "calls.jsonl");
    assert.equal(calls.includes("secret transcript"), false);
    assert.equal(calls.includes("zelda@example.com"), false);
    assert.equal(calls.includes("recent call with no name"), true);

    const stored = JSON.parse(await readText(dir, CALLER_NAMES_FILE)) as Record<
      string,
      { name: string; lastHeardAt: string }
    >;
    assert.equal(stored[NUMBER].name, NAME);
    assert.equal(stored[NUMBER].lastHeardAt, heardAt);
    assert.equal(JSON.stringify(stored).includes("secret transcript"), false);
    assert.equal(first.log.includes(NAME), false);
    assert.equal(first.log.includes(NUMBER), false);
    assert.equal(first.log.includes("07900 900687"), false);

    const memory = await lookupCallerMemory(NUMBER, { dataDir: dir, timeoutMs: 2000 });
    assert.deepEqual(memory, { name: NAME, calledAt: heardAt });

    const later = new Date(now.getTime() + 26 * DAY);
    const second = await purgePersonalData({ dataDir: dir, now: later, retentionDays: 30 });
    assert.equal(second.callsPurged, 1);
    assert.equal(second.namesPurged, 1);
    assert.equal((await readText(dir, "calls.jsonl")).includes("recent call"), false);
    assert.equal(await exists(path.join(dir, CALLER_NAMES_FILE)), false);
    assert.equal(await lookupCallerMemory(NUMBER, { dataDir: dir, timeoutMs: 2000 }), undefined);
  });
});

test("a national lead number refreshes the name, and a transfer label is not a name", async () => {
  await withDir(async (dir) => {
    const now = new Date();
    const heardAt = ago(now, 3);
    await writeJsonl(dir, "calls.jsonl", [
      {
        type: "call_summary",
        callerNumber: NUMBER,
        startedAt: ago(now, 40),
        transcript: "secret transcript",
        tools: [{ arguments: { name: NAME } }],
      },
    ]);
    await writeJsonl(dir, "leads.jsonl", [
      {
        type: "message",
        name: "transfer_to_grant",
        from: "<sip:+447700900687@pstn.twilio.com>",
        receivedAt: heardAt,
        notes: "Transfer succeeded",
      },
    ]);

    await purgePersonalData({ dataDir: dir, now, retentionDays: 30 });
    const stored = JSON.parse(await readText(dir, CALLER_NAMES_FILE)) as Record<string, { name: string; lastHeardAt: string }>;
    assert.deepEqual(stored[NUMBER], {
      name: NAME,
      nameAt: ago(now, 40),
      lastHeardAt: heardAt,
    });
    assert.equal((await readText(dir, "calls.jsonl")).includes("secret transcript"), false);
    assert.equal((await readText(dir, "leads.jsonl")).includes("transfer_to_grant"), true);

    const onlyTransfer = path.join(dir, "only-transfer");
    await fs.mkdir(onlyTransfer);
    await writeJsonl(onlyTransfer, "leads.jsonl", [
      { type: "message", name: "transfer_to_grant", phone: NUMBER, receivedAt: heardAt },
    ]);
    await purgePersonalData({ dataDir: onlyTransfer, now, retentionDays: 30 });
    assert.equal(await exists(path.join(onlyTransfer, CALLER_NAMES_FILE)), false);
  });
});

test("a record with no timestamp is dated on first sight and expires one period later", async () => {
  await withDir(async (dir) => {
    const now = new Date();
    await writeJsonl(dir, "calls.jsonl", [
      { type: "call_summary", callerName: NAME, callerNumber: NUMBER, transcript: "no clock", startedAt: "not-a-date" },
    ]);
    const first = await purgePersonalData({ dataDir: dir, now, retentionDays: 30 });
    assert.equal(first.timestampsBackfilled, 1);
    assert.equal(first.callsPurged, 0);
    const saved = JSON.parse((await readText(dir, "calls.jsonl")).trim()) as { receivedAt?: string; startedAt?: string };
    assert.equal(saved.receivedAt, now.toISOString());
    assert.equal(saved.startedAt, "not-a-date");

    const later = new Date(now.getTime() + 31 * DAY);
    const second = await purgePersonalData({ dataDir: dir, now: later, retentionDays: 30 });
    assert.equal(second.callsPurged, 1);
    assert.equal((await readText(dir, "calls.jsonl")).includes("no clock"), false);
    assert.equal(await exists(path.join(dir, CALLER_NAMES_FILE)), false);
  });
});

test("an unreadable line is kept for one period and then deleted, without being logged", async () => {
  await withDir(async (dir) => {
    const now = new Date();
    const junk = `not json ${NUMBER} ${NAME}`;
    await fs.writeFile(path.join(dir, "calls.jsonl"), `${junk}\n`);
    await fs.writeFile(path.join(dir, "notes.txt"), "leave this file");
    await fs.writeFile(path.join(dir, ".calls.jsonl.99.retention-tmp"), `temp ${NUMBER}`);

    const first = await capture(() => purgePersonalData({ dataDir: dir, now, retentionDays: 30 }));
    assert.equal(first.result.timestampsBackfilled, 1);
    assert.equal(first.result.unreadablePurged, 0);
    assert.equal(first.result.tempFilesRemoved, 1);
    assert.equal(first.result.otherFiles, 1);
    assert.equal(await readText(dir, "calls.jsonl"), `${junk}\n`);
    assert.equal(await readText(dir, "notes.txt"), "leave this file");
    assert.equal(await exists(path.join(dir, ".calls.jsonl.99.retention-tmp")), false);
    assert.equal(first.log.includes(NUMBER), false);
    assert.equal(first.log.includes(NAME), false);
    assert.equal(first.log.includes("notes.txt"), false);
    assert.match(first.log, /backfilled 1 timestamps/);
    assert.match(first.log, /removed 1 temp files/);
    assert.match(first.log, /left 1 other files/);

    const later = new Date(now.getTime() + 31 * DAY);
    const second = await purgePersonalData({ dataDir: dir, now: later, retentionDays: 30 });
    assert.equal(second.unreadablePurged, 1);
    assert.equal(await readText(dir, "calls.jsonl"), "");
    assert.equal(await readText(dir, "notes.txt"), "leave this file");
  });
});

test("an append during the purge is not lost", async () => {
  await withDir(async (dir) => {
    const now = new Date();
    await writeJsonl(dir, "calls.jsonl", [
      { type: "call_summary", callId: "old", callerNumber: NUMBER, startedAt: ago(now, 40), transcript: "secret transcript" },
      { type: "call_summary", callId: "kept", callerNumber: "+447700900222", startedAt: ago(now, 2), transcript: "keep me" },
    ]);

    const prev = process.env.DATA_DIR;
    process.env.DATA_DIR = dir;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let opened = false;
    try {
      const purgeP = purgePersonalData({
        dataDir: dir,
        now,
        retentionDays: 30,
        afterRead: async () => {
          opened = true;
          await gate;
        },
      });
      const start = Date.now();
      while (!opened) {
        if (Date.now() - start > 2000) throw new Error("purge did not reach the lock");
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      const appendP = persistCallRecord({
        type: "call_summary",
        callId: "new",
        callerNumber: "+447700900333",
        startedAt: now.toISOString(),
        transcript: "arrived during purge",
      });
      release();
      await purgeP;
      await appendP;
      const text = await readText(dir, "calls.jsonl");
      assert.equal(text.includes("secret transcript"), false);
      assert.equal(text.includes("keep me"), true);
      assert.equal(text.includes("arrived during purge"), true);
      assert.equal(text.includes(NUMBER), false);
    } finally {
      release();
      if (prev === undefined) delete process.env.DATA_DIR;
      else process.env.DATA_DIR = prev;
    }
  });
});

test("a name already on its own expires with lastHeardAt, and a bad name file is rebuilt", async () => {
  await withDir(async (dir) => {
    const now = new Date();
    await fs.writeFile(
      path.join(dir, CALLER_NAMES_FILE),
      `${JSON.stringify({
        [NUMBER]: { name: NAME, nameAt: ago(now, 20), lastHeardAt: ago(now, 40) },
        "+447700900222": { name: "Sam Taylor", nameAt: ago(now, 4), lastHeardAt: ago(now, 4) },
      })}\n`,
    );
    const expired = await purgePersonalData({ dataDir: dir, now, retentionDays: 30 });
    assert.equal(expired.namesPurged, 1);
    const kept = JSON.parse(await readText(dir, CALLER_NAMES_FILE)) as Record<string, { name: string }>;
    assert.equal(kept[NUMBER], undefined);
    assert.equal(kept["+447700900222"].name, "Sam Taylor");

    await fs.writeFile(path.join(dir, CALLER_NAMES_FILE), "{not json");
    await writeJsonl(dir, "calls.jsonl", [
      { type: "call_summary", callerName: "Priya Shah", callerNumber: "+447700900333", startedAt: ago(now, 1) },
    ]);
    const rebuilt = await purgePersonalData({ dataDir: dir, now, retentionDays: 30 });
    assert.equal(rebuilt.unreadablePurged, 1);
    const names = JSON.parse(await readText(dir, CALLER_NAMES_FILE)) as Record<string, { name: string }>;
    assert.equal(names["+447700900333"].name, "Priya Shah");
    assert.equal(names["+447700900222"], undefined);
  });
});

test("retention runs once on start and again on the interval", async () => {
  let runs = 0;
  const handle = startPersonalDataRetention({
    intervalMs: 30,
    purge: async () => {
      runs += 1;
      return emptyResult();
    },
  });
  try {
    const start = Date.now();
    while (runs < 2) {
      if (Date.now() - start > 2000) throw new Error(`purge ran ${runs} times`);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  } finally {
    handle.stop();
  }
  const settled = runs;
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(runs, settled);
});

test("a non-directory data path fails without deleting anything else", async () => {
  await withDir(async (dir) => {
    const file = path.join(dir, "not-a-dir");
    await fs.writeFile(file, "keep");
    await assert.rejects(() => purgePersonalData({ dataDir: file, now: new Date() }), /not a directory/);
    assert.equal(await readText(dir, "not-a-dir"), "keep");
  });
});
