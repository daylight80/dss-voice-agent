import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import { AMBER_GREETING_HINT, AMBER_INSTRUCTIONS, amberOpeningLine } from "../src/amber-prompt.js";
import { callerMemoryLine } from "../src/caller-memory.js";
import { callerNumberLine } from "../src/caller-number.js";
import { AMBER_TOOLS } from "../src/tools.js";

test("Amber's spoken script does not name Grant", async () => {
  const spoken = [
    AMBER_INSTRUCTIONS,
    JSON.stringify(AMBER_TOOLS),
    callerNumberLine("+447700900687"),
    callerMemoryLine("Jane Smith", new Date("2026-10-02T15:00:00.000Z")),
    AMBER_GREETING_HINT(new Date("2026-11-05T13:03:00.000Z")),
  ].join("\n");
  assert.doesNotMatch(spoken, /Grant/);
  assert.match(spoken, /a member of our team/);
  assert.match(spoken, /emailed to the team at hello@drivingschoolsolutions\.co\.uk/);
  assert.match(spoken, /Book a callback with a member of our team/);
  assert.match(spoken, /Leave a message that will be emailed to the team/);
  assert.match(spoken, /Transfer this live call to a member of our team/);

  const session = await fs.readFile(new URL("../src/call-session.ts", import.meta.url), "utf8");
  const callerLines = session
    .split("\n")
    .filter(
      (line) =>
        line.includes("will ring them back") ||
        line.includes("will be emailed") ||
        line.includes("will follow up"),
    );
  assert.equal(callerLines.length, 3);
  for (const line of callerLines) assert.doesNotMatch(line, /Grant/);
  const afternoon = new Date("2026-11-05T13:03:00.000Z");
  const opening =
    "Good Afternoon. Thank you for calling Driving School Solutions, Amber speaking. Just so you know calls are recorded and transcribed for quality and training. How may I assist you today?";
  assert.equal(amberOpeningLine(afternoon), opening);
  assert.equal(AMBER_GREETING_HINT(afternoon), `Open with this exact script and no other words: "${opening}"`);
  assert.equal(
    amberOpeningLine(new Date("2026-11-05T08:00:00.000Z")),
    opening.replace("Good Afternoon", "Good Morning"),
  );
  assert.equal(
    amberOpeningLine(new Date("2026-11-05T18:30:00.000Z")),
    opening.replace("Good Afternoon", "Good Evening"),
  );
  assert.match(
    AMBER_INSTRUCTIONS,
    /Good Morning\/Good Afternoon\/Good Evening\. Thank you for calling Driving School Solutions, Amber speaking\. Just so you know calls are recorded and transcribed for quality and training\. How may I assist you today\?/,
  );

  assert.match(session, /a member of our team will ring them back/);
  assert.match(session, /emailed to the team\. Confirm that to the caller/);
  assert.match(session, /a member of our team will follow up/);
});
