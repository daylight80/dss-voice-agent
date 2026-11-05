import assert from "node:assert/strict";
import test from "node:test";
import { TranscriptLog } from "../src/transcript.js";

test("keeps caller and Amber in spoken order, including a hangup mid-sentence", () => {
  const log = new TranscriptLog();
  log.ingest({
    type: "response.output_audio_transcript.delta",
    item_id: "amber-1",
    delta: "Good Afternoon. ",
  });
  log.ingest({
    type: "response.output_audio_transcript.delta",
    item_id: "amber-1",
    delta: "Thank you for calling.",
  });
  log.ingest({
    type: "response.output_audio_transcript.done",
    item_id: "amber-1",
    transcript: "Good Afternoon. Thank you for calling.",
  });
  log.ingest({ type: "input_audio_buffer.speech_stopped", item_id: "caller-1" });
  log.ingest({
    type: "conversation.item.input_audio_transcription.updated",
    item_id: "caller-1",
    transcript: "I want a web",
  });
  log.ingest({
    type: "conversation.item.input_audio_transcription.completed",
    item_id: "caller-1",
    transcript: "I want a website please",
  });
  log.ingest({
    type: "response.output_audio_transcript.delta",
    item_id: "amber-2",
    delta: "Of course, may I take",
  });

  assert.deepEqual(log.lines(), [
    "Amber: Good Afternoon. Thank you for calling.",
    "Caller: I want a website please",
    "Amber: Of course, may I take",
  ]);
});

test("a late caller transcript does not jump below Amber's reply", () => {
  const log = new TranscriptLog();
  log.ingest({ type: "conversation.item.added", item: { id: "u1", type: "message", role: "user", content: [] } });
  log.ingest({
    type: "response.output_audio_transcript.done",
    item_id: "a1",
    transcript: "How can I help?",
  });
  log.ingest({
    type: "conversation.item.input_audio_transcription.completed",
    item_id: "u1",
    transcript: "Hello there",
  });
  assert.deepEqual(log.lines(), ["Caller: Hello there", "Amber: How can I help?"]);
});

test("truncation replaces the unspoken tail, and empty calls stay empty", () => {
  const log = new TranscriptLog();
  log.ingest({
    type: "response.output_audio_transcript.done",
    item_id: "a1",
    transcript: "I can tell you all about our websites and SEO packages in detail.",
  });
  log.ingest({
    type: "conversation.item.truncated",
    item_id: "a1",
    transcript: "I can tell you all about our websites",
  });
  log.ingest({ type: "response.function_call_arguments.done", name: "save_lead" });
  log.ingest({ type: "input_audio_buffer.dtmf_event_received", event: "5" });
  assert.deepEqual(log.lines(), [
    "Amber: I can tell you all about our websites",
    "Caller: (pressed 5)",
  ]);

  const silent = new TranscriptLog();
  silent.ingest({ type: "session.updated" });
  silent.ingest(null);
  silent.ingest({ type: "input_audio_buffer.speech_stopped", item_id: "noise" });
  assert.deepEqual(silent.lines(), []);
});
