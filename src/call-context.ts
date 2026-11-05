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
 * Unknown callers use the standard opening. A remembered name is inserted
 * before the question, after the recording notice. AMBER_GREETING_HINT itself
 * is left unchanged.
 */
export function buildGreetingInstructions(memory: CallerMemory | undefined, now = new Date()): string {
  if (!memory) return AMBER_GREETING_HINT(now);
  const first = firstName(memory.name);
  const line = amberOpeningLine(now);
  const question = "How may I assist you today?";
  const named = `Hi ${first}, nice to hear from you again. ${question}`;
  const script = line.endsWith(question) ? `${line.slice(0, -question.length)}${named}` : `${line} ${named}`;
  return `Open with this exact script and no other words: "${script}"`;
}
