/**
 * Optional postcode and theory-test answers on a driving-lesson enquiry.
 * Normalise what we can. Never throw, and never drop the rest of the enquiry.
 */

/** Outward code, then inward code (one digit and two letters). */
const UK_POSTCODE = /^([A-Z]{1,2}\d[A-Z\d]?)(\d[A-Z]{2})$/;

const EXACT_THEORY: Record<string, string> = {
  yes: "Passed",
  y: "Passed",
  yeah: "Passed",
  yep: "Passed",
  passed: "Passed",
  "has passed": "Passed",
  "have passed": "Passed",
  "i have passed": "Passed",
  "they have passed": "Passed",
  "they've passed": "Passed",
  no: "Not passed",
  n: "Not passed",
  nope: "Not passed",
  "not passed": "Not passed",
  "not yet": "Not passed",
  "has not passed": "Not passed",
  "have not passed": "Not passed",
  "hasn't passed": "Not passed",
  "haven't passed": "Not passed",
  booked: "Booked",
  "test booked": "Booked",
  "theory booked": "Booked",
  "not sure": "Not sure",
  unsure: "Not sure",
  "don't know": "Not sure",
  "do not know": "Not sure",
  "not certain": "Not sure",
  "booked or not sure": "Booked or not sure",
  "not sure or booked": "Booked or not sure",
};

/**
 * Upper case, with the usual space before the inward code when the value
 * looks like a UK postcode. Anything else is kept in upper case.
 */
export function normalisePostcode(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (!trimmed) return undefined;

  const withoutLabel = trimmed.replace(/^post\s*code\s*[:\-]?\s*/i, "").trim();
  const source = withoutLabel || trimmed;
  const compact = source.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!compact) return source.toUpperCase();

  if (compact === "GIR0AA") return "GIR 0AA";
  const bfpo = /^BFPO(\d{1,4})$/.exec(compact);
  if (bfpo) return `BFPO ${bfpo[1]}`;

  const match = UK_POSTCODE.exec(compact);
  if (match) return `${match[1]} ${match[2]}`;
  return source.toUpperCase().replace(/\s+/g, " ");
}

/**
 * Map a theory-test answer onto a short label the owner can scan.
 * Unrecognised answers are kept as spoken, so a call is never rejected.
 */
export function normaliseTheoryTestStatus(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const tidy = value.trim().replace(/\s+/g, " ");
  if (!tidy) return undefined;

  const stripped = tidy.replace(/^theory\s*test(?:\s*status)?\s*[:\-]?\s*/i, "").trim();
  const source = stripped || tidy;
  const text = source
    .toLowerCase()
    .replace(/[’]/g, "'")
    .replace(/[^a-z0-9'\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return undefined;

  const exact = EXACT_THEORY[text];
  if (exact) return exact;

  const hasNotSure = /\b(not sure|unsure|uncertain|don't know|do not know|not certain)\b/.test(text);
  const hasBooked = /\bbook(?:ed|ing)\b/.test(text);
  const bookedNegated = /\b(?:not|no|never|haven't|hasn't)\b[\s\w']{0,40}\bbook/.test(text);

  if (hasNotSure && hasBooked) return "Booked or not sure";
  if (hasNotSure) return "Not sure";
  if (hasBooked && !bookedNegated) return "Booked";
  if (
    bookedNegated ||
    /\b(not yet|not passed|haven't passed|hasn't passed|have not passed|has not passed|didn't pass|did not pass|failed|nope|haven't|hasn't|have not|has not)\b/.test(
      text,
    ) ||
    /^(no|n|not)\b/.test(text)
  ) {
    return "Not passed";
  }
  if (/\b(passed|yes|yeah|yep)\b/.test(text) || /\bpass\b/.test(text)) return "Passed";

  return source.replace(/\s+/g, " ");
}

/** Write canonical postcode and theory_test_status onto tool arguments, in place. */
export function applyEnquiryDetails(args: Record<string, unknown>): void {
  const postcode = normalisePostcode(args.postcode);
  if (postcode) args.postcode = postcode;
  else delete args.postcode;

  const theory =
    normaliseTheoryTestStatus(args.theory_test_status) ?? normaliseTheoryTestStatus(args.theory_test);
  if (theory) args.theory_test_status = theory;
  else delete args.theory_test_status;
  delete args.theory_test;
}
