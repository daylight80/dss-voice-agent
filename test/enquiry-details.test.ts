import assert from "node:assert/strict";
import test from "node:test";
import { applyEnquiryDetails, normalisePostcode, normaliseTheoryTestStatus } from "../src/enquiry-details.js";
import { renderLeadEmail, type LeadRecord } from "../src/notify.js";
import { AMBER_TOOLS } from "../src/tools.js";

test("postcodes are upper case with a space when they look like a UK postcode", () => {
  assert.equal(normalisePostcode("sm52ab"), "SM5 2AB");
  assert.equal(normalisePostcode("  sm5 2ab  "), "SM5 2AB");
  assert.equal(normalisePostcode("SM5  2AB"), "SM5 2AB");
  assert.equal(normalisePostcode("SM5-2AB"), "SM5 2AB");
  assert.equal(normalisePostcode("s m 5 2 a b"), "SM5 2AB");
  assert.equal(normalisePostcode("sw1a1aa"), "SW1A 1AA");
  assert.equal(normalisePostcode("ec1a 1bb"), "EC1A 1BB");
  assert.equal(normalisePostcode("m11ae"), "M1 1AE");
  assert.equal(normalisePostcode("W1A 0AX"), "W1A 0AX");
  assert.equal(normalisePostcode("dn551pt"), "DN55 1PT");
  assert.equal(normalisePostcode("cr26xh"), "CR2 6XH");
  assert.equal(normalisePostcode("gir 0aa"), "GIR 0AA");
  assert.equal(normalisePostcode("bfpo 15"), "BFPO 15");
  assert.equal(normalisePostcode("Postcode: sm5 2ab"), "SM5 2AB");
  assert.equal(normalisePostcode("SM5 2AB"), "SM5 2AB");
});

test("a postcode that is incomplete or not a postcode is still kept", () => {
  assert.equal(normalisePostcode("SM5"), "SM5");
  assert.equal(normalisePostcode("near the high street"), "NEAR THE HIGH STREET");
  assert.equal(normalisePostcode("SM5 2AB or SM1 4LS"), "SM5 2AB OR SM1 4LS");
  assert.equal(normalisePostcode(""), undefined);
  assert.equal(normalisePostcode("   "), undefined);
  assert.equal(normalisePostcode(undefined), undefined);
  assert.equal(normalisePostcode(12), undefined);
  assert.doesNotThrow(() => normalisePostcode({ area: "Sutton" }));
});

test("theory test answers become a short label and unknown answers are kept", () => {
  assert.equal(normaliseTheoryTestStatus("yes"), "Passed");
  assert.equal(normaliseTheoryTestStatus("YES"), "Passed");
  assert.equal(normaliseTheoryTestStatus("Passed"), "Passed");
  assert.equal(normaliseTheoryTestStatus("Yes, they have passed"), "Passed");
  assert.equal(normaliseTheoryTestStatus("no"), "Not passed");
  assert.equal(normaliseTheoryTestStatus("not yet"), "Not passed");
  assert.equal(normaliseTheoryTestStatus("I haven't passed"), "Not passed");
  assert.equal(normaliseTheoryTestStatus("booked"), "Booked");
  assert.equal(normaliseTheoryTestStatus("I've booked it"), "Booked");
  assert.equal(normaliseTheoryTestStatus("not sure"), "Not sure");
  assert.equal(normaliseTheoryTestStatus("I'm not sure"), "Not sure");
  assert.equal(normaliseTheoryTestStatus("booked or not sure"), "Booked or not sure");
  assert.equal(normaliseTheoryTestStatus("Theory test: yes"), "Passed");
  assert.equal(normaliseTheoryTestStatus("I sat it last Tuesday"), "I sat it last Tuesday");
  assert.equal(normaliseTheoryTestStatus(""), undefined);
  assert.equal(normaliseTheoryTestStatus(null), undefined);
  assert.doesNotThrow(() => normaliseTheoryTestStatus(["yes"]));
});

test("enquiry arguments are normalised in place and a missing answer is dropped", () => {
  const args: Record<string, unknown> = {
    name: "Sam Taylor",
    postcode: "sm52ab",
    theory_test: "yes",
  };
  applyEnquiryDetails(args);
  assert.deepEqual(args, {
    name: "Sam Taylor",
    postcode: "SM5 2AB",
    theory_test_status: "Passed",
  });

  const rough: Record<string, unknown> = {
    name: "Sam Taylor",
    postcode: "near the high street",
    theory_test_status: "haven't booked it yet",
  };
  assert.doesNotThrow(() => applyEnquiryDetails(rough));
  assert.equal(rough.postcode, "NEAR THE HIGH STREET");
  assert.equal(rough.theory_test_status, "Not passed");

  const skipped: Record<string, unknown> = { name: "Sam Taylor", postcode: "  ", theory_test_status: "" };
  applyEnquiryDetails(skipped);
  assert.deepEqual(skipped, { name: "Sam Taylor" });
});

test("lesson enquiry tools take an optional postcode and theory test status", () => {
  for (const name of ["save_lead", "book_callback", "leave_message"] as const) {
    const tool = AMBER_TOOLS.find((item) => item.name === name);
    assert.ok(tool);
    const properties = tool.parameters.properties as Record<string, { type?: string }>;
    const required = tool.parameters.required as readonly string[];
    assert.equal(properties.postcode?.type, "string");
    assert.equal(properties.theory_test_status?.type, "string");
    assert.equal(required.includes("postcode"), false);
    assert.equal(required.includes("theory_test_status"), false);
  }

  const transfer = AMBER_TOOLS.find((item) => item.name === "transfer_to_grant");
  assert.ok(transfer);
  assert.equal("postcode" in transfer.parameters.properties, false);
  assert.equal("theory_test_status" in transfer.parameters.properties, false);
});

test("lead emails show postcode and theory test, and older leads still render", () => {
  const email = renderLeadEmail({
    type: "lead",
    callId: "call_lesson",
    receivedAt: "2026-11-05T13:03:00.000Z",
    name: "Sam Taylor",
    phone: "+447700900111",
    postcode: "SM5 2AB",
    theory_test_status: "Passed",
    interest: "Driving lessons",
  });
  assert.match(email.subject, /new lead — Sam Taylor/);
  assert.match(email.text, /Postcode: SM5 2AB/);
  assert.match(email.text, /Theory test: Passed/);

  const callback = renderLeadEmail({
    type: "callback",
    callId: "call_cb",
    receivedAt: "2026-11-05T13:03:00.000Z",
    name: "Sam Taylor",
    phone: "+447700900111",
    postcode: "SW1A 1AA",
    theory_test_status: "Booked",
  });
  assert.match(callback.text, /Postcode: SW1A 1AA/);
  assert.match(callback.text, /Theory test: Booked/);

  const older: LeadRecord = {
    type: "lead",
    callId: "call_old",
    receivedAt: "2026-01-01T00:00:00.000Z",
    name: "Jane",
    phone: "+447700900687",
  };
  const previous = renderLeadEmail(older);
  assert.match(previous.text, /Name: Jane/);
  assert.match(previous.text, /Phone: \+447700900687/);
  assert.doesNotMatch(previous.text, /Postcode/);
  assert.doesNotMatch(previous.text, /Theory test/);
});
