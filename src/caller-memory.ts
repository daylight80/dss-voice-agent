import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";
import { callerNumberFrom } from "./caller-number.js";
import { formatLondonDay } from "./london-time.js";

export type CallerMemory = {
  name: string;
  /**
   * ISO time used as "last call" in the greeting.
   * A call or lead line contributes that record's own time.
   * caller-names.json contributes the most recent contact from the number.
   */
  calledAt: string;
};

/** Minimal name memory written by the retention purge. No transcript. */
export const CALLER_NAMES_FILE = "caller-names.json";

const CONTACT_FIELDS = ["startedAt", "receivedAt", "endedAt"] as const;
const NUMBER_FIELDS = ["callerNumber", "phone", "from"] as const;

const NOT_A_CALLER_NAME = new Set([
  "transfer_to_grant",
  "unknown",
  "anonymous",
  "withheld",
  "unavailable",
  "restricted",
  "caller",
  "n/a",
  "na",
  "none",
  "null",
  "undefined",
]);

const CHUNK_BYTES = 32 * 1024;

export function cleanCallerName(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const name = value.trim().replace(/\s+/g, " ");
  if (!name) return undefined;
  if (NOT_A_CALLER_NAME.has(name.toLowerCase())) return undefined;
  if (/^\+?\d[\d\s()-]{5,}$/.test(name)) return undefined;
  return name;
}

export function firstName(name: string): string {
  const cleaned = name.trim().replace(/\s+/g, " ");
  const [first] = cleaned.split(" ");
  return first || cleaned;
}

export function memoryNumbers(record: Record<string, unknown>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const key of NUMBER_FIELDS) {
    const value = record[key];
    if (typeof value !== "string") continue;
    const e164 = callerNumberFrom(value);
    if (!e164 || seen.has(e164)) continue;
    seen.add(e164);
    out.push(e164);
  }
  return out;
}

export function memoryName(record: Record<string, unknown>): string | undefined {
  let name = cleanCallerName(record.callerName) ?? cleanCallerName(record.name);
  if (!name && Array.isArray(record.tools)) {
    for (let i = record.tools.length - 1; i >= 0; i--) {
      const tool = record.tools[i];
      if (!tool || typeof tool !== "object") continue;
      const args = (tool as { arguments?: unknown }).arguments;
      if (!args || typeof args !== "object") continue;
      name = cleanCallerName((args as { name?: unknown }).name);
      if (name) break;
    }
  }
  return name;
}

/** Latest usable contact time on a call or lead record. Invalid strings are skipped. */
export function latestContactAt(record: Record<string, unknown>): string | undefined {
  let best: string | undefined;
  let bestMs = Number.NEGATIVE_INFINITY;
  for (const key of CONTACT_FIELDS) {
    const value = record[key];
    if (typeof value !== "string" || !value.trim()) continue;
    const ms = Date.parse(value);
    if (!Number.isFinite(ms) || ms < bestMs) continue;
    best = value;
    bestMs = ms;
  }
  return best;
}

/** First usable contact time, which is what a JSONL line reports as calledAt. */
export function memoryCalledAt(record: Record<string, unknown>): string | undefined {
  for (const key of CONTACT_FIELDS) {
    const value = record[key];
    if (typeof value !== "string" || !value.trim()) continue;
    if (!Number.isFinite(Date.parse(value))) continue;
    return value;
  }
  return undefined;
}

export function callerMemoryLine(name: string, calledAt: Date): string {
  const first = firstName(name);
  const date = formatLondonDay(calledAt);
  return `This number has called before as ${name} (last call ${date}). Greet them warmly by name, e.g. "Hi ${first}, nice to hear from you again", but check it is them, as someone else may be using the phone; if not, ask their name as normal. Do not reveal details of previous calls unless the caller confirms who they are.`;
}

type SearchOptions = {
  dataDir?: string;
  timeoutMs?: number;
  /** Test hook. Production scans DATA_DIR. */
  search?: () => Promise<CallerMemory | undefined>;
};

/**
 * Most recent name stored against this E.164 number.
 * Scans newest JSONL lines first and gives up when the time budget passes,
 * so a slow disk cannot stall the call.
 */
export async function lookupCallerMemory(
  e164: string,
  options?: SearchOptions,
): Promise<CallerMemory | undefined> {
  const timeoutMs = options?.timeoutMs ?? 1500;
  const search =
    options?.search ??
    (() => searchDataDir(e164, options?.dataDir ?? config.dataDir, timeoutMs));

  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), timeoutMs);
  });

  try {
    const result = await Promise.race([
      search().catch((err: unknown) => {
        console.error("[caller-memory] lookup failed", err);
        return undefined;
      }),
      timeout,
    ]);
    return result;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function searchDataDir(
  e164: string,
  dataDir: string,
  timeoutMs: number,
): Promise<CallerMemory | undefined> {
  const deadline = Date.now() + timeoutMs;
  const stop = () => Date.now() > deadline;
  const [fromLeads, fromCalls, fromNames] = await Promise.all([
    latestNamedCall(path.join(dataDir, "leads.jsonl"), e164, stop),
    latestNamedCall(path.join(dataDir, "calls.jsonl"), e164, stop),
    nameMemoryFromStore(path.join(dataDir, CALLER_NAMES_FILE), e164, stop),
  ]);
  return newer(newer(fromLeads, fromCalls), fromNames);
}

function newer(a: CallerMemory | undefined, b: CallerMemory | undefined): CallerMemory | undefined {
  if (!a) return b;
  if (!b) return a;
  const aTime = Date.parse(a.calledAt);
  const bTime = Date.parse(b.calledAt);
  if (!Number.isFinite(aTime)) return Number.isFinite(bTime) ? b : a;
  if (!Number.isFinite(bTime)) return a;
  return aTime >= bTime ? a : b;
}

function recordMemory(record: Record<string, unknown>, e164: string): CallerMemory | undefined {
  if (!memoryNumbers(record).includes(e164)) return undefined;
  const name = memoryName(record);
  const at = memoryCalledAt(record);
  if (!name || !at) return undefined;
  return { name, calledAt: at };
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Name kept after the call that supplied it was deleted. Ignored once
 * lastHeardAt is older than the retention period, so a missed purge cannot
 * keep greeting with an expired name. A missing or unreadable file just
 * means there is no extra memory; the JSONL scan still runs.
 */
async function nameMemoryFromStore(
  file: string,
  e164: string,
  shouldStop: () => boolean,
): Promise<CallerMemory | undefined> {
  if (shouldStop()) return undefined;
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return undefined;
    console.error("[caller-memory] name store could not be read");
    return undefined;
  }
  if (shouldStop()) return undefined;

  let parsed: unknown;
  try {
    parsed = raw.trim() ? (JSON.parse(raw) as unknown) : undefined;
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
  const entry = (parsed as Record<string, unknown>)[e164];
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return undefined;
  const record = entry as Record<string, unknown>;
  const name = cleanCallerName(record.name);
  const at = typeof record.lastHeardAt === "string" ? record.lastHeardAt : undefined;
  if (!name || !at || !Number.isFinite(Date.parse(at))) return undefined;
  const ageMs = Date.now() - Date.parse(at);
  if (ageMs > config.dataRetentionDays * DAY_MS) return undefined;
  return { name, calledAt: at };
}

/**
 * Newest matching named record in a JSONL file, reading from the end.
 * Returns undefined if the file is missing, the budget runs out, or nobody matches.
 */
async function latestNamedCall(
  file: string,
  e164: string,
  shouldStop: () => boolean,
): Promise<CallerMemory | undefined> {
  let fh: fs.FileHandle | undefined;
  try {
    fh = await fs.open(file, "r");
    const { size } = await fh.stat();
    if (size === 0) return undefined;

    let pos = size;
    let pending: Buffer<ArrayBufferLike> = Buffer.alloc(0);

    while (pos > 0) {
      if (shouldStop()) return undefined;
      const start = Math.max(0, pos - CHUNK_BYTES);
      const len = pos - start;
      const chunk = Buffer.alloc(len);
      await fh.read(chunk, 0, len, start);
      pos = start;

      const data = pending.length ? Buffer.concat([chunk, pending]) : chunk;
      const lines = completeLinesFromEnd(data, start > 0);
      pending = lines.pending;

      for (let i = lines.text.length - 1; i >= 0; i--) {
        if (shouldStop()) return undefined;
        const line = lines.text[i].trim();
        if (!line) continue;
        let parsed: unknown;
        try {
          parsed = JSON.parse(line);
        } catch {
          continue;
        }
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
        const memory = recordMemory(parsed as Record<string, unknown>, e164);
        if (memory) return memory;
      }
    }

    return undefined;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return undefined;
    throw err;
  } finally {
    await fh?.close().catch(() => undefined);
  }
}

function completeLinesFromEnd(
  data: Buffer,
  keepLeadingPartial: boolean,
): { text: string[]; pending: Buffer<ArrayBufferLike> } {
  const newlineAt: number[] = [];
  for (let i = 0; i < data.length; i++) {
    if (data[i] === 0x0a) newlineAt.push(i);
  }

  if (keepLeadingPartial && newlineAt.length === 0) {
    return { text: [], pending: data };
  }

  const firstComplete = keepLeadingPartial ? newlineAt[0] + 1 : 0;
  const pending = keepLeadingPartial ? data.subarray(0, newlineAt[0]) : Buffer.alloc(0);
  const complete = data.subarray(firstComplete).toString("utf8");
  return { text: complete.split("\n"), pending };
}
