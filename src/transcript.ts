/**
 * Both sides of an xAI realtime call.
 *
 * Caller text comes from conversation.item.input_audio_transcription.completed
 * (final) and .updated (cumulative partial, when grok-transcribe is on).
 * Amber's text comes from response.output_audio_transcript.done, with deltas
 * kept so a hangup mid-sentence is still in the email.
 * Turn order follows the first time we see each item, which is when speech
 * stops or the item is added — not when the transcript arrives later.
 */

type Role = "caller" | "amber";

type Turn = {
  id: string;
  role: Role;
  text: string;
  final: boolean;
  truncated: boolean;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return value;
}

function textFromContent(content: unknown): string {
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const part of content) {
    const record = asRecord(part);
    if (!record) continue;
    const transcript = asString(record.transcript);
    const text = asString(record.text);
    if (transcript?.trim()) parts.push(transcript);
    else if (text?.trim()) parts.push(text);
  }
  return parts.join(" ").trim();
}

function roleOf(value: unknown): Role | undefined {
  if (value === "user") return "caller";
  if (value === "assistant") return "amber";
  return undefined;
}

export class TranscriptLog {
  private turns: Turn[] = [];
  private byId = new Map<string, Turn>();
  private order = 0;

  ingest(event: unknown): void {
    const record = asRecord(event);
    if (!record) return;
    const type = asString(record.type);
    if (!type) return;

    switch (type) {
      case "input_audio_buffer.speech_stopped":
      case "input_audio_buffer.committed": {
        const id = asString(record.item_id);
        if (id) this.ensure(id, "caller");
        return;
      }
      case "conversation.item.added":
      case "conversation.item.created":
      case "response.output_item.added": {
        this.noteItem(record.item);
        return;
      }
      case "conversation.item.deleted": {
        const id = asString(record.item_id);
        if (!id) return;
        this.turns = this.turns.filter((turn) => turn.id !== id);
        this.byId.delete(id);
        return;
      }
      case "conversation.item.truncated": {
        const id = asString(record.item_id);
        if (!id) return;
        this.applyTruncate(id, asString(record.transcript));
        return;
      }
      case "conversation.item.input_audio_transcription.updated": {
        const id = asString(record.item_id);
        const text = asString(record.transcript);
        if (id && text?.trim()) this.applyCallerSnapshot(id, text);
        return;
      }
      case "conversation.item.input_audio_transcription.completed": {
        const id = asString(record.item_id);
        const text = asString(record.transcript);
        if (id && text?.trim()) this.applyCallerFinal(id, text);
        return;
      }
      case "response.output_audio_transcript.delta":
      case "response.audio_transcript.delta": {
        const id = this.amberId(record);
        const delta = asString(record.delta);
        if (id && delta) this.applyAmberDelta(id, delta);
        return;
      }
      case "response.output_audio_transcript.done":
      case "response.audio_transcript.done": {
        const id = this.amberId(record);
        const text = asString(record.transcript);
        if (id && text?.trim()) this.applyAmberFinal(id, text);
        return;
      }
      case "response.content_part.done": {
        const id = this.amberId(record);
        const part = asRecord(record.part);
        const text = asString(part?.transcript) ?? asString(part?.text);
        if (id && text?.trim()) this.applyAmberFinal(id, text);
        return;
      }
      case "response.done": {
        this.noteResponseDone(record.response);
        return;
      }
      case "input_audio_buffer.dtmf_event_received": {
        const digit = dtmfDigit(record);
        if (!digit) return;
        const turn = this.ensure(`dtmf-${this.order}`, "caller");
        turn.text = `(pressed ${digit})`;
        turn.final = true;
        return;
      }
      default:
        return;
    }
  }

  lines(): string[] {
    const lines: string[] = [];
    for (const turn of this.turns) {
      const text = turn.text.replace(/\s+/g, " ").trim();
      if (!text) continue;
      lines.push(`${turn.role === "caller" ? "Caller" : "Amber"}: ${text}`);
    }
    return lines;
  }

  private ensure(id: string, role: Role): Turn {
    const existing = this.byId.get(id);
    if (existing) return existing;
    const turn: Turn = { id, role, text: "", final: false, truncated: false };
    this.byId.set(id, turn);
    this.turns.push(turn);
    this.order += 1;
    return turn;
  }

  private noteItem(raw: unknown): void {
    const item = asRecord(raw);
    if (!item) return;
    const itemType = asString(item.type);
    if (itemType && itemType !== "message") return;
    const role = roleOf(item.role);
    const id = asString(item.id) ?? asString(item.item_id);
    if (!role || !id) return;
    const turn = this.ensure(id, role);
    const text = textFromContent(item.content);
    if (!text || turn.final || turn.truncated) return;
    if (!turn.text || role === "caller") turn.text = text;
  }

  private noteResponseDone(raw: unknown): void {
    const response = asRecord(raw);
    const output = response?.output;
    if (!Array.isArray(output)) return;
    for (const item of output) {
      const record = asRecord(item);
      if (!record) continue;
      const itemType = asString(record.type);
      if (itemType && itemType !== "message") continue;
      const role = roleOf(record.role) ?? "amber";
      const id = asString(record.id);
      const text = textFromContent(record.content);
      if (!id || !text) continue;
      if (role === "caller") this.applyCallerFinal(id, text);
      else this.applyAmberFinal(id, text);
    }
  }

  private amberId(event: Record<string, unknown>): string | undefined {
    return asString(event.item_id) ?? (asString(event.response_id) ? `response:${asString(event.response_id)}` : undefined);
  }

  private applyCallerSnapshot(id: string, text: string): void {
    const turn = this.ensure(id, "caller");
    if (turn.final || turn.truncated) return;
    turn.text = text;
  }

  private applyCallerFinal(id: string, text: string): void {
    const turn = this.ensure(id, "caller");
    if (turn.truncated) return;
    turn.text = text;
    turn.final = true;
  }

  private applyAmberDelta(id: string, delta: string): void {
    const turn = this.ensure(id, "amber");
    if (turn.final || turn.truncated) return;
    turn.text += delta;
  }

  private applyAmberFinal(id: string, text: string): void {
    const turn = this.ensure(id, "amber");
    if (turn.final || turn.truncated) return;
    turn.text = text;
    turn.final = true;
  }

  private applyTruncate(id: string, text: string | undefined): void {
    const turn = this.byId.get(id) ?? this.ensure(id, "amber");
    turn.truncated = true;
    turn.final = true;
    if (text?.trim()) turn.text = text;
  }
}

function dtmfDigit(event: Record<string, unknown>): string | undefined {
  const raw = event.event ?? event.digit;
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  const record = asRecord(raw);
  const digit = record ? asString(record.digit) ?? asString(record.event) : undefined;
  return digit?.trim() || undefined;
}
