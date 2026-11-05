import assert from "node:assert/strict";
import test from "node:test";
import {
  callerNumberFrom,
  callerNumberLine,
  isWithheldCaller,
  lastThreeDigits,
  resolveToolPhone,
  toE164,
} from "../src/caller-number.js";

test("parses SIP and TEL caller IDs into E.164", () => {
  assert.equal(callerNumberFrom("<sip:+447700900687@pstn.twilio.com>;tag=abc"), "+447700900687");
  assert.equal(callerNumberFrom('"Jane Smith" <sip:+447700900687@host>'), "+447700900687");
  assert.equal(callerNumberFrom("sip:+44-7700-900687@host"), "+447700900687");
  assert.equal(callerNumberFrom("<tel:+447700900687>"), "+447700900687");
  assert.equal(callerNumberFrom("tel:+447700900687;tag=1"), "+447700900687");
  assert.equal(callerNumberFrom("+447700900687"), "+447700900687");
  assert.equal(callerNumberFrom("07900 900687"), "+447900900687");
  assert.equal(callerNumberFrom("00447700900687"), "+447700900687");
  assert.equal(callerNumberFrom("447700900687"), "+447700900687");
  assert.equal(toE164("020 7946 0958"), "+442079460958");
});

test("withheld, anonymous and unavailable numbers stay unknown", () => {
  for (const header of [
    undefined,
    "",
    "anonymous",
    "Anonymous",
    '"Anonymous" <sip:anonymous@anonymous.invalid>',
    "<sip:anonymous@anonymous.invalid>",
    "sip:withheld@host",
    "<sip:unavailable@host>",
    "restricted",
    '"Unavailable" <sip:restricted@1.2.3.4>',
    "sip:private@unknown",
  ]) {
    assert.equal(callerNumberFrom(header), undefined, `expected no number for ${String(header)}`);
  }
  assert.equal(isWithheldCaller('"Anonymous" <sip:anonymous@anonymous.invalid>'), true);
  assert.equal(isWithheldCaller("<sip:+447700900687@host>"), false);
});

test("number instruction uses the real last three digits and is not added for an unknown caller", () => {
  assert.equal(lastThreeDigits("+447700900687"), "687");
  const line = callerNumberLine("+447700900687");
  assert.match(line, /The caller is ringing from \+447700900687/);
  assert.match(
    line,
    /Is the number you're calling from, ending 687, the best one to reach you on\?/,
  );
  assert.match(line, /If they want a different number, take that instead/);
});

test("tools use the caller ID unless a different number was given", () => {
  const caller = "+447700900687";
  assert.equal(resolveToolPhone(undefined, caller), caller);
  assert.equal(resolveToolPhone("  ", caller), caller);
  assert.equal(resolveToolPhone("ending 687", caller), caller);
  assert.equal(resolveToolPhone("the number I'm calling from", caller), caller);
  assert.equal(resolveToolPhone("07700 900687", caller), caller);
  assert.equal(resolveToolPhone("+447911111111", caller), "+447911111111");
  assert.equal(resolveToolPhone("020 7946 0958", caller), "+442079460958");
  assert.equal(resolveToolPhone("07900 900111", undefined), "+447900900111");
  assert.equal(resolveToolPhone(undefined, undefined), undefined);
});
