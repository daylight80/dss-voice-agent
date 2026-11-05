import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { config, parseRetentionDays } from "./config.js";
import { withDataLock } from "./data-lock.js";
import { callerNumberFrom } from "./caller-number.js";
import {
  CALLER_NAMES_FILE,
  cleanCallerName,
  latestContactAt,
  memoryName,
  memoryNumbers,
} from "./caller-memory.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const CALLS_FILE = "calls.jsonl";
const LEADS_FILE = "leads.jsonl";
const META_FILE = "retention-meta.json";
const KNOWN_FILES = new Set([CALLS_FILE, LEADS_FILE, CALLER_NAMES_FILE, META_FILE, ".gitkeep"]);

export const RETENTION_INTERVAL_MS = DAY_MS;

export type PurgeResult = {
  callsPurged: number;
  leadsPurged: number;
  namesPurged: number;
  timestampsBackfilled: number;
  unreadablePurged: number;
  tempFilesRemoved: number;
  otherFiles: number;
};

export type PurgeOptions = {
  now?: Date;
  dataDir?: string;
  retentionDays?: number;
  /**
   * Test hook. Runs inside the data lock after the store is read and before
   * it is replaced. Must not take the data lock (that would deadlock).
   */
  afterRead?: () => Promise<void> | void;
};

type NameAcc = {
  name?: string;
  nameAtMs: number;
  lastHeardMs: number;
};

type NameEntry = {
  name: string;
  nameAt: string;
  lastHeardAt: string;
};

type Line =
  | { kind: "blank" }
  | { kind: "unreadable"; raw: string }
  | { kind: "record"; raw: string; record: Record<string, unknown> };

type Meta = { unreadable: Record<string, string> };

const EMPTY: PurgeResult = {
  callsPurged: 0,
  leadsPurged: 0,
  namesPurged: 0,
  timestampsBackfilled: 0,
  unreadablePurged: 0,
  tempFilesRemoved: 0,
  otherFiles: 0,
};

/**
 * Delete personal data Amber has written under DATA_DIR once it is older than
 * the retention period.
 *
 * Call transcripts, summaries and lead lines are aged from that record's own
 * contact time (the latest of startedAt / receivedAt / endedAt). Caller-name
 * memory is not a separate store today: a name is whatever the newest named
 * lead or call line said. Deleting that line would forget someone who rang
 * again more recently and did not repeat their name. The purge therefore
 * keeps a minimal caller-names.json entry (number, name, when the name was
 * captured, when we last heard from that number) and drops the entry only
 * when the most recent call or lead from that number is itself past retention.
 * The name file has no transcript.
 *
 * A record with no usable timestamp is dated on first sight (receivedAt) and
 * kept for one full period, rather than deleted immediately or kept forever.
 * An unreadable line is hashed and dated the same way, then deleted. The hash
 * file stores no personal data.
 */
export async function purgePersonalData(options?: PurgeOptions): Promise<PurgeResult> {
  const now = options?.now ?? new Date();
  const days =
    options?.retentionDays == null ? config.dataRetentionDays : parseRetentionDays(String(options.retentionDays));
  const dataDir = options?.dataDir ?? config.dataDir;
  const result = await withDataLock(() => purgeLocked(dataDir, now, days, options?.afterRead));
  console.log(formatPurgeLog(result, days));
  return result;
}

export function formatPurgeLog(result: PurgeResult, days: number): string {
  let line =
    `[retention] purged ${result.callsPurged} call records, ` +
    `${result.leadsPurged} lead records, ${result.namesPurged} caller names`;
  if (result.timestampsBackfilled) line += `; backfilled ${result.timestampsBackfilled} timestamps`;
  if (result.unreadablePurged) line += `; purged ${result.unreadablePurged} unreadable lines`;
  if (result.tempFilesRemoved) line += `; removed ${result.tempFilesRemoved} temp files`;
  if (result.otherFiles) line += `; left ${result.otherFiles} other files`;
  line += ` (retention ${formatDays(days)} days)`;
  return line;
}

function formatDays(days: number): string {
  if (Number.isInteger(days)) return String(days);
  return String(days);
}

type RetentionController = { stop: () => void };

let active: RetentionController | undefined;

/**
 * Purge shortly after startup, then once a day, without blocking the HTTP
 * server. A second call returns the controller already running. Overlapping
 * ticks are skipped. Timers are unref'd so they do not keep a finished
 * process alive.
 */
export function startPersonalDataRetention(options?: {
  intervalMs?: number;
  purge?: () => Promise<PurgeResult>;
}): RetentionController {
  if (active) return active;

  const intervalMs = options?.intervalMs ?? RETENTION_INTERVAL_MS;
  const purge = options?.purge ?? (() => purgePersonalData());
  let running = false;
  let stopped = false;

  const run = () => {
    if (stopped || running) {
      if (running) console.log("[retention] purge already running; skipped");
      return;
    }
    running = true;
    void Promise.resolve()
      .then(() => purge())
      .catch((err: unknown) => {
        console.error("[retention] purge failed", err);
      })
      .finally(() => {
        running = false;
      });
  };

  const startup = setTimeout(run, 0);
  startup.unref?.();
  const interval = setInterval(run, intervalMs);
  interval.unref?.();

  const controller: RetentionController = {
    stop: () => {
      stopped = true;
      clearTimeout(startup);
      clearInterval(interval);
      if (active === controller) active = undefined;
    },
  };
  active = controller;
  console.log(`[retention] personal data retention is ${formatDays(config.dataRetentionDays)} days`);
  return controller;
}

async function purgeLocked(
  dataDir: string,
  now: Date,
  days: number,
  afterRead?: () => Promise<void> | void,
): Promise<PurgeResult> {
  const result: PurgeResult = { ...EMPTY };
  let dirStat: Awaited<ReturnType<typeof fs.stat>>;
  try {
    dirStat = await fs.stat(dataDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return result;
    throw err;
  }
  if (!dirStat.isDirectory()) {
    throw new Error("Data path is not a directory");
  }

  result.tempFilesRemoved = await removeStaleTemps(dataDir);

  const callsPath = path.join(dataDir, CALLS_FILE);
  const leadsPath = path.join(dataDir, LEADS_FILE);
  const namesPath = path.join(dataDir, CALLER_NAMES_FILE);
  const metaPath = path.join(dataDir, META_FILE);

  const [calls, leads, existingNames, meta] = await Promise.all([
    readLines(callsPath),
    readLines(leadsPath),
    readNameFile(namesPath),
    readMeta(metaPath),
  ]);

  if (afterRead) await afterRead();

  const cutoff = now.getTime() - days * DAY_MS;
  const nowIso = now.toISOString();
  const names = new Map<string, NameAcc>();

  const callsOut = settleFile(calls, cutoff, nowIso, names, result, "callsPurged", meta);
  const leadsOut = settleFile(leads, cutoff, nowIso, names, result, "leadsPurged", meta);

  if (existingNames.ok) {
    absorbNameFile(existingNames.entries, names);
  }

  const nextNames = nameStoreToKeep(names, cutoff, now, result);
  const previousKeys = existingNames.ok ? Object.keys(existingNames.entries) : [];
  const droppedNames = new Set<string>();
  for (const rawKey of previousKeys) {
    const key = normalNameKey(rawKey);
    if (!key || !nextNames[key]) droppedNames.add(key ?? rawKey);
  }
  result.namesPurged += droppedNames.size;
  if (!existingNames.ok && existingNames.existed) {
    result.unreadablePurged += 1;
  }

  const nextMeta = compactMeta(meta, callsOut.keptHashes, leadsOut.keptHashes);
  await writeNameFile(namesPath, nextNames, existingNames.existed);
  await writeJsonl(callsPath, calls.existed, calls.text, callsOut.lines);
  await writeJsonl(leadsPath, leads.existed, leads.text, leadsOut.lines);
  await writeMeta(metaPath, nextMeta, meta.existed);

  result.otherFiles = await countOtherFiles(dataDir);
  return result;
}

function settleFile(
  loaded: LoadedLines,
  cutoff: number,
  nowIso: string,
  names: Map<string, NameAcc>,
  result: PurgeResult,
  purgedKey: "callsPurged" | "leadsPurged",
  meta: MetaFile,
): { lines: string[]; keptHashes: Set<string> } {
  const lines: string[] = [];
  const keptHashes = new Set<string>();

  for (const line of loaded.lines) {
    if (line.kind === "blank") continue;
    if (line.kind === "unreadable") {
      const hash = hashLine(line.raw);
      const firstSeen = meta.unreadable[hash];
      if (!firstSeen || !Number.isFinite(Date.parse(firstSeen))) {
        meta.unreadable[hash] = nowIso;
        result.timestampsBackfilled += 1;
        lines.push(line.raw);
        keptHashes.add(hash);
        continue;
      }
      if (Date.parse(firstSeen) < cutoff) {
        result.unreadablePurged += 1;
        continue;
      }
      lines.push(line.raw);
      keptHashes.add(hash);
      continue;
    }

    const at = latestContactAt(line.record);
    if (!at) {
      line.record.receivedAt = nowIso;
      result.timestampsBackfilled += 1;
      considerRecord(names, line.record, nowIso);
      lines.push(JSON.stringify(line.record));
      continue;
    }

    considerRecord(names, line.record, at);
    if (Date.parse(at) < cutoff) {
      result[purgedKey] += 1;
      continue;
    }
    lines.push(line.raw);
  }

  return { lines, keptHashes };
}

function considerRecord(names: Map<string, NameAcc>, record: Record<string, unknown>, atIso: string): void {
  const atMs = Date.parse(atIso);
  if (!Number.isFinite(atMs)) return;
  const numbers = memoryNumbers(record);
  if (!numbers.length) return;
  const name = memoryName(record);
  for (const number of numbers) {
    const acc = names.get(number) ?? freshAcc();
    if (atMs > acc.lastHeardMs) acc.lastHeardMs = atMs;
    if (name && atMs >= acc.nameAtMs) {
      acc.name = name;
      acc.nameAtMs = atMs;
    }
    names.set(number, acc);
  }
}

function absorbNameFile(entries: Record<string, unknown>, names: Map<string, NameAcc>): void {
  for (const [rawKey, value] of Object.entries(entries)) {
    const key = normalNameKey(rawKey);
    if (!key || !value || typeof value !== "object" || Array.isArray(value)) continue;
    const entry = value as Record<string, unknown>;
    const name = cleanCallerName(entry.name);
    const last = typeof entry.lastHeardAt === "string" ? Date.parse(entry.lastHeardAt) : NaN;
    const nameAt = typeof entry.nameAt === "string" ? Date.parse(entry.nameAt) : NaN;
    const acc = names.get(key) ?? freshAcc();
    if (Number.isFinite(last) && last > acc.lastHeardMs) acc.lastHeardMs = last;
    if (name && Number.isFinite(nameAt) && nameAt >= acc.nameAtMs) {
      acc.name = name;
      acc.nameAtMs = nameAt;
    } else if (name && !Number.isFinite(nameAt) && Number.isFinite(last) && last >= acc.nameAtMs) {
      acc.name = name;
      acc.nameAtMs = last;
    }
    names.set(key, acc);
  }
}

function nameStoreToKeep(
  names: Map<string, NameAcc>,
  cutoff: number,
  now: Date,
  result: PurgeResult,
): Record<string, NameEntry> {
  const next: Record<string, NameEntry> = {};
  for (const key of [...names.keys()].sort()) {
    const acc = names.get(key);
    if (!acc?.name) continue;
    let last = acc.lastHeardMs;
    if (!Number.isFinite(last) || last === Number.NEGATIVE_INFINITY) {
      last = now.getTime();
      result.timestampsBackfilled += 1;
    }
    if (last < cutoff) continue;
    const nameAt =
      Number.isFinite(acc.nameAtMs) && acc.nameAtMs !== Number.NEGATIVE_INFINITY ? acc.nameAtMs : last;
    next[key] = {
      name: acc.name,
      nameAt: new Date(nameAt).toISOString(),
      lastHeardAt: new Date(last).toISOString(),
    };
  }
  return next;
}

function freshAcc(): NameAcc {
  return { nameAtMs: Number.NEGATIVE_INFINITY, lastHeardMs: Number.NEGATIVE_INFINITY };
}

function normalNameKey(rawKey: string): string | undefined {
  return callerNumberFrom(rawKey) ?? (/^\+\d{8,15}$/.test(rawKey) ? rawKey : undefined);
}

function hashLine(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

function compactMeta(meta: MetaFile, ...kept: Array<Set<string>>): Meta {
  const keep = new Set<string>();
  for (const set of kept) for (const hash of set) keep.add(hash);
  const unreadable: Record<string, string> = {};
  for (const [hash, seen] of Object.entries(meta.unreadable)) {
    if (keep.has(hash)) unreadable[hash] = seen;
  }
  return { unreadable };
}

type LoadedLines = { existed: boolean; text: string; lines: Line[] };

async function readLines(file: string): Promise<LoadedLines> {
  try {
    const text = await fs.readFile(file, "utf8");
    return { existed: true, text, lines: splitLines(text).map(parseLine) };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { existed: false, text: "", lines: [] };
    throw err;
  }
}

function splitLines(text: string): string[] {
  if (!text) return [];
  const lines = text.split(/\r?\n/);
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function parseLine(raw: string): Line {
  const trimmed = raw.trim();
  if (!trimmed) return { kind: "blank" };
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { kind: "unreadable", raw: trimmed };
    return { kind: "record", raw: trimmed, record: parsed as Record<string, unknown> };
  } catch {
    return { kind: "unreadable", raw: trimmed };
  }
}

type NameFile =
  | { ok: true; existed: boolean; entries: Record<string, unknown> }
  | { ok: false; existed: boolean };

async function readNameFile(file: string): Promise<NameFile> {
  try {
    const text = await fs.readFile(file, "utf8");
    try {
      const parsed = JSON.parse(text) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { ok: false, existed: true };
      return { ok: true, existed: true, entries: parsed as Record<string, unknown> };
    } catch {
      return { ok: false, existed: true };
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { ok: true, existed: false, entries: {} };
    throw err;
  }
}

type MetaFile = Meta & { existed: boolean };

async function readMeta(file: string): Promise<MetaFile> {
  try {
    const text = await fs.readFile(file, "utf8");
    try {
      const parsed = JSON.parse(text) as { unreadable?: unknown };
      const unreadable: Record<string, string> = {};
      if (parsed?.unreadable && typeof parsed.unreadable === "object" && !Array.isArray(parsed.unreadable)) {
        for (const [hash, seen] of Object.entries(parsed.unreadable)) {
          if (typeof seen === "string") unreadable[hash] = seen;
        }
      }
      return { existed: true, unreadable };
    } catch {
      return { existed: true, unreadable: {} };
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { existed: false, unreadable: {} };
    throw err;
  }
}

async function writeJsonl(file: string, existed: boolean, previous: string, lines: string[]): Promise<void> {
  const next = lines.length ? `${lines.join("\n")}\n` : "";
  if (!existed && next === "") return;
  if (next === previous) return;
  await atomicReplace(file, next);
}

async function writeNameFile(
  file: string,
  entries: Record<string, NameEntry>,
  existed: boolean,
): Promise<void> {
  if (!Object.keys(entries).length) {
    if (existed) await fs.rm(file, { force: true });
    return;
  }
  const next = `${JSON.stringify(entries)}\n`;
  let previous = "";
  if (existed) {
    previous = await fs.readFile(file, "utf8").catch(() => "");
  }
  if (next === previous) return;
  await atomicReplace(file, next);
}

async function writeMeta(file: string, meta: Meta, existed: boolean): Promise<void> {
  if (!Object.keys(meta.unreadable).length) {
    if (existed) await fs.rm(file, { force: true });
    return;
  }
  const next = `${JSON.stringify(meta)}\n`;
  await atomicReplace(file, next);
}

async function atomicReplace(file: string, contents: string): Promise<void> {
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.retention-tmp`);
  const handle = await fs.open(tmp, "w", 0o600);
  try {
    await handle.writeFile(contents, "utf8");
    await handle.sync();
  } catch (err) {
    await handle.close().catch(() => undefined);
    await fs.rm(tmp, { force: true }).catch(() => undefined);
    throw err;
  }
  await handle.close();
  try {
    await fs.rename(tmp, file);
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
    throw err;
  }
}

async function removeStaleTemps(dataDir: string): Promise<number> {
  const names = await fs.readdir(dataDir);
  let removed = 0;
  for (const name of names) {
    if (!name.endsWith(".retention-tmp")) continue;
    await fs.rm(path.join(dataDir, name), { force: true });
    removed += 1;
  }
  return removed;
}

async function countOtherFiles(dataDir: string): Promise<number> {
  const names = await fs.readdir(dataDir);
  let others = 0;
  for (const name of names) {
    if (KNOWN_FILES.has(name) || name.endsWith(".retention-tmp")) continue;
    others += 1;
  }
  return others;
}
