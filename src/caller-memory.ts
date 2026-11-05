import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";
import { callerNumberFrom } from "./caller-number.js";
import { formatLondonDay } from "./london-time.js";

export type CallerMemory = {
  name: string;
  /** ISO timestamp of the record that supplied the name. */
  calledAt: string;
};

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
  const [fromLeads, fromCalls] = await Promise.all([
    latestNamedCall(path.join(dataDir, "leads.jsonl"), e164, stop),
    latestNamedCall(path.join(dataDir, "calls.jsonl"), e164, stop),
  ]);
  return newer(fromLeads, fromCalls);
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
  const numbers = [record.callerNumber, record.phone, record.from];
  const matched = numbers.some((value) => typeof value === "string" && callerNumberFrom(value) === e164);
  if (!matched) return undefined;

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
  if (!name) return undefined;

  const at = [record.startedAt, record.receivedAt, record.endedAt].find(
    (value) => typeof value === "string" && value.trim(),
  );
  if (typeof at !== "string") return undefined;
  if (!Number.isFinite(Date.parse(at))) return undefined;
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
