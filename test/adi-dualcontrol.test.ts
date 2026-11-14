import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { saveAdiEnquiry } from "../src/adi-enquiry.js";
import {
  mapAdiEnquiryToDualControl,
  sendAdiEnquiryToDualControl,
  type DualControlEnquiryBody,
} from "../src/adi-dualcontrol.js";

const FULL = {
  name: "  Alex Patel  ",
  phone: " 07790 333444 ",
  email: "alex@example.com",
  lesson_type: "Automatic",
  pickup_postcode: " sm5 4nq ",
  lesson_availability: "Weekday evenings",
  theory_passed: "Yes",
  notes: "Nervous about roundabouts",
};

test("the DualControl mapper labels lesson type, postcode, and theory", () => {
  const body = mapAdiEnquiryToDualControl(FULL);
  assert.ok(body);
  assert.equal(body.name, "Alex Patel");
  assert.equal(body.phone, "07790 333444");
  assert.equal(body.email, "");
  assert.equal(body.company_website, "");
  assert.equal(body.consent, "Happy to be contacted");
  assert.equal(body.postcode, "SM5 4NQ");
  assert.equal(body.availability, "Weekday evenings");
  assert.equal(body.theory_test, "Passed");
  assert.equal(body.transmission, "Automatic");
  assert.match(body.message, /^Via ADI website chat/);
  assert.match(body.message, /Email: alex@example.com/);
  assert.match(body.message, /Nervous about roundabouts/);

  const manual = mapAdiEnquiryToDualControl({ ...FULL, lesson_type: "manual", theory_passed: "No" });
  assert.equal(manual?.transmission, "Manual");
  assert.equal(manual?.theory_test, "Not yet");

  const booked = mapAdiEnquiryToDualControl({ ...FULL, theory_passed: "Booked" });
  assert.equal(booked?.theory_test, "Booked");

  const unsure = mapAdiEnquiryToDualControl({ ...FULL, lesson_type: "not sure" });
  assert.equal(unsure?.transmission, undefined);
  assert.match(unsure?.message ?? "", /Lesson type: not sure/);

  const longPostcode = mapAdiEnquiryToDualControl({ ...FULL, pickup_postcode: "SM5 4NQ EXTRA" });
  assert.equal(longPostcode?.postcode, undefined);
  assert.match(longPostcode?.message ?? "", /Pickup postcode: SM5 4NQ EXTRA/);

  assert.equal(mapAdiEnquiryToDualControl({ ...FULL, phone: "   " }), undefined);
  assert.equal(mapAdiEnquiryToDualControl({ ...FULL, name: "" }), undefined);
  assert.equal(mapAdiEnquiryToDualControl({ ...FULL, name: "A".repeat(140) })?.name.length, 100);
  assert.equal(mapAdiEnquiryToDualControl({ ...FULL, phone: "1".repeat(40) })?.phone.length, 30);
});

test("DualControl is posted only when the key and a phone are present", async () => {
  const previousKey = process.env.ADI_DUALCONTROL_FORM_KEY;
  const previousBase = process.env.ADI_DUALCONTROL_API_BASE;
  const errors: string[] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => {
    errors.push(args.map(String).join(" "));
  };

  const calls: Array<{ url: string; body?: DualControlEnquiryBody }> = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)) as DualControlEnquiryBody });
    return new Response("ok", { status: 201 });
  }) as typeof fetch;

  try {
    delete process.env.ADI_DUALCONTROL_FORM_KEY;
    const missingKey = await sendAdiEnquiryToDualControl(FULL, { fetchImpl });
    assert.equal(missingKey, "skipped");
    assert.equal(calls.length, 0);

    process.env.ADI_DUALCONTROL_FORM_KEY = "secret-form-key";
    process.env.ADI_DUALCONTROL_API_BASE = "https://example.test/api/";
    const missingPhone = await sendAdiEnquiryToDualControl({ ...FULL, phone: "" }, { fetchImpl });
    assert.equal(missingPhone, "skipped");
    assert.equal(calls.length, 0);

    const sent = await sendAdiEnquiryToDualControl(FULL, { fetchImpl });
    assert.equal(sent, "sent");
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, "https://example.test/api/public/enquiries/secret-form-key");
    assert.equal(calls[0]?.body?.transmission, "Automatic");
    assert.equal(calls[0]?.body?.consent, "Happy to be contacted");

    const rejected = await sendAdiEnquiryToDualControl(FULL, {
      fetchImpl: (async () => new Response("no", { status: 422 })) as typeof fetch,
    });
    assert.equal(rejected, "failed");
    assert.match(errors.join("\n"), /422/);
    assert.doesNotMatch(errors.join("\n"), /secret-form-key/);

    const offline = await sendAdiEnquiryToDualControl(FULL, {
      fetchImpl: (async () => {
        throw new Error("network down");
      }) as typeof fetch,
    });
    assert.equal(offline, "failed");
    assert.match(errors.join("\n"), /Error/);
    assert.doesNotMatch(errors.join("\n"), /secret-form-key/);
  } finally {
    console.error = originalError;
    restore("ADI_DUALCONTROL_FORM_KEY", previousKey);
    restore("ADI_DUALCONTROL_API_BASE", previousBase);
  }
});

test("a DualControl failure does not undo a saved ADI enquiry", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "adi-dc-"));
  const previous = {
    DATA_DIR: process.env.DATA_DIR,
    EMAIL_WEBHOOK_URL: process.env.EMAIL_WEBHOOK_URL,
    NOTIFY_TO_EMAIL: process.env.NOTIFY_TO_EMAIL,
    ADI_DUALCONTROL_FORM_KEY: process.env.ADI_DUALCONTROL_FORM_KEY,
    ADI_DUALCONTROL_API_BASE: process.env.ADI_DUALCONTROL_API_BASE,
  };
  process.env.DATA_DIR = dir;
  process.env.EMAIL_WEBHOOK_URL = "https://example.test/mail";
  process.env.NOTIFY_TO_EMAIL = "grant@example.com";
  process.env.ADI_DUALCONTROL_FORM_KEY = "secret-form-key";
  process.env.ADI_DUALCONTROL_API_BASE = "https://example.test/api";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request) => {
    if (String(url).includes("/public/enquiries/")) throw new Error("network down");
    return new Response("ok", { status: 202 });
  }) as typeof fetch;

  try {
    const saved = await saveAdiEnquiry({
      tool: "save_lead",
      conversationId: "44444444-4444-4444-8444-444444444444",
      now: new Date("2026-11-14T10:00:00.000Z"),
      args: { name: "Alex Patel", phone: "07790 333444", lesson_type: "manual" },
    });
    assert.equal(saved.saved, true);
    const lines = (await fs.readFile(path.join(dir, "leads.jsonl"), "utf8")).trim().split("\n");
    assert.equal(lines.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [name, value] of Object.entries(previous)) restore(name, value);
    await fs.rm(dir, { recursive: true, force: true });
  }
});

function restore(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
