import { AMBER_GREETING_HINT, AMBER_INSTRUCTIONS, amberOpeningLine } from "./amber-prompt.js";
import { callerNumberLine } from "./caller-number.js";
import { callerMemoryLine, firstName, type CallerMemory } from "./caller-memory.js";

/**
 * Base prompt plus optional lines for this call only.
 * AMBER_INSTRUCTIONS itself is never rewritten.
 */
export function buildCallInstructions(input: {
  callerNumber?: string;
  memory?: CallerMemory;
}): string {
  const extras: string[] = [];
  if (input.callerNumber) extras.push(callerNumberLine(input.callerNumber));
  if (input.callerNumber && input.memory) {
    const at = new Date(input.memory.calledAt);
    if (!Number.isNaN(at.getTime())) extras.push(callerMemoryLine(input.memory.name, at));
  }
  if (!extras.length) return AMBER_INSTRUCTIONS;
  return `${AMBER_INSTRUCTIONS}\n\n${extras.join("\n\n")}`;
}

/**
 * Opening response instructions.
 * Unknown callers keep Grant's exact greeting. A remembered name extends that
 * opening for this call only; AMBER_GREETING_HINT is left unchanged.
 */
export function buildGreetingInstructions(memory: CallerMemory | undefined, now = new Date()): string {
  if (!memory) return AMBER_GREETING_HINT(now);
  const first = firstName(memory.name);
  const line = amberOpeningLine(now);
  const warm = line.replace(
    / how may I assist you\?$/,
    `. Hi ${first}, nice to hear from you again. How may I assist you?`,
  );
  const script = warm === line ? `${line} Hi ${first}, nice to hear from you again.` : warm;
  return `Open with this exact script and no other words: "${script}"`;
}
