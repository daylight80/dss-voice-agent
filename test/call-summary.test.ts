import assert from "node:assert/strict";
import test from "node:test";
import {
  formatToolDetails,
  outcomeFor,
  renderCallSummaryEmail,
  summariseTranscript,
  type CapturedTool,
} from "../src/call-summary.js";
import { formatDuration, formatLondonDateTime } from "../src/london-time.js";

const started = new Date("2026-11-05T13:03:00.000Z");
const ended = new Date("2026-11-05T13:04:20.000Z");

test("London clock follows GMT and BST", () => {
  assert.deepEqual(formatLondonDateTime(started), {
    date: "Thursday 5 November 2026",
    time: "13:03",
  });
  assert.deepEqual(formatLondonDateTime(new Date("2026-06-15T23:30:00.000Z")), {
    date: "Tuesday 16 June 2026",
    time: "00:30",
  });
});

test("duration is written in plain English", () => {
  assert.equal(formatDuration(0), "0 seconds");
  assert.equal(formatDuration(1), "1 second");
  assert.equal(formatDuration(60), "1 minute");
  assert.equal(formatDuration(80), "1 minute 20 seconds");
  assert.equal(formatDuration(3661), "1 hour 1 minute 1 second");
});

test("outcome lists every successful tool and ignores a failed transfer", () => {
  const tools: CapturedTool[] = [
    { name: "save_lead", args: { name: "Jane" }, result: { ok: true }, at: started.toISOString() },
    { name: "book_callback", args: { name: "Jane" }, result: { ok: true }, at: started.toISOString() },
    { name: "transfer_to_grant", args: {}, result: { ok: false, transferred: false }, at: started.toISOString() },
  ];
  assert.equal(outcomeFor(tools), "Lead saved; Callback booked");
  assert.equal(outcomeFor([]), "None");
  assert.equal(
    outcomeFor([
      { name: "transfer_to_grant", args: {}, result: { transferred: true }, at: started.toISOString() },
    ]),
    "Transferred to Grant",
  );
});

test("summary details show a lesson enquiry postcode and theory test", () => {
  const text = formatToolDetails([
    {
      name: "save_lead",
      args: {
        name: "Sam Taylor",
        phone: "+447700900111",
        postcode: "SM5 2AB",
        theory_test_status: "Passed",
      },
      result: { ok: true },
      at: started.toISOString(),
    },
  ]);
  assert.match(text, /Lead saved/);
  assert.match(text, /Postcode: SM5 2AB/);
  assert.match(text, /Theory test: Passed/);

  const older = formatToolDetails([
    { name: "save_lead", args: { name: "Jane" }, result: { ok: true }, at: started.toISOString() },
  ]);
  assert.equal(older, "Lead saved\n  Name: Jane");
  assert.doesNotMatch(older, /Postcode/);
  assert.doesNotMatch(older, /Theory/);
});

test("summary email for a real call", () => {
  const email = renderCallSummaryEmail({
    callId: "call_123",
    callerNumber: "+447700900687",
    callerName: "Jane Smith",
    startedAt: started,
    endedAt: ended,
    outcome: "Callback booked",
    summary:
      "Jane Smith rang about a website for her driving school in Sutton and booked a callback for tomorrow morning.",
    details: "Callback booked\n  Name: Jane Smith\n  Phone: +447700900687\n  Preferred time: Tomorrow morning",
    transcript: [
      "Amber: Good Afternoon. Thank you for calling Driving School Solutions, Amber speaking. Hi Jane, nice to hear from you again. How may I assist you?",
      "Caller: I'd like a website for my driving school, please.",
      "Amber: Is the number you're calling from, ending 687, the best one to reach you on?",
    ].join("\n"),
  });

  assert.equal(email.subject, "Amber call summary: +447700900687 at 13:03");
  assert.equal(
    email.text,
    [
      "Caller: +447700900687",
      "Name: Jane Smith",
      "Started: Thursday 5 November 2026, 13:03 (London)",
      "Duration: 1 minute 20 seconds",
      "Call ID: call_123",
      "Outcome: Callback booked",
      "",
      "Summary:",
      "Jane Smith rang about a website for her driving school in Sutton and booked a callback for tomorrow morning.",
      "",
      "Details captured:",
      "Callback booked",
      "  Name: Jane Smith",
      "  Phone: +447700900687",
      "  Preferred time: Tomorrow morning",
      "",
      "Transcript:",
      "Amber: Good Afternoon. Thank you for calling Driving School Solutions, Amber speaking. Hi Jane, nice to hear from you again. How may I assist you?",
      "Caller: I'd like a website for my driving school, please.",
      "Amber: Is the number you're calling from, ending 687, the best one to reach you on?",
      "",
      "— Amber, Driving School Solutions",
    ].join("\n"),
  );
});

test("a silent call still has an email, and a failed summary keeps the transcript", async () => {
  const silent = renderCallSummaryEmail({
    callId: "call_missed",
    sipFrom: '"Anonymous" <sip:anonymous@anonymous.invalid>',
    startedAt: started,
    endedAt: started,
    outcome: "None",
    summary: "No speech was captured. The caller may have hung up straight away.",
    details: "None",
    transcript: "",
  });
  assert.equal(silent.subject, "Amber call summary: unknown number at 13:03");
  assert.match(silent.text, /Caller: Unknown/);
  assert.match(silent.text, /SIP From: "Anonymous" <sip:anonymous@anonymous.invalid>/);
  assert.match(silent.text, /No speech was captured/);
  assert.match(silent.text, /\(no speech captured\)/);

  let called = false;
  const none = await summariseTranscript(
    { transcript: "", details: "None", outcome: "None" },
    { fetchImpl: async () => {
      called = true;
      throw new Error("should not be called");
    } },
  );
  assert.equal(called, false);
  assert.equal(none.summary, "No speech was captured. The caller may have hung up straight away.");

  const failed = await summariseTranscript(
    { transcript: "Caller: Hello", details: "None", outcome: "None" },
    { fetchImpl: async () => { throw new Error("network down"); }, apiKey: "test-key" },
  );
  assert.equal(failed.source, "fallback");
  assert.match(failed.summary, /could not be generated/);
});
