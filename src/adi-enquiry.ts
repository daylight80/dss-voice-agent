/**
 * ADI enquiries use the same lead file and email path as Mirra, tagged so
 * they can be read and notified on their own.
 */

import { config } from "./config.js";
import { saveMirraEnquiry, type EnquiryField, type EnquiryProfile, type EnquiryResult } from "./mirra-enquiry.js";
import type { LeadType } from "./notify.js";

/** Asked, in order, when someone wants to check lesson availability. */
export const ADI_AVAILABILITY_FIELDS: EnquiryField[] = [
  { key: "name", label: "Name", ask: "What's your name?" },
  {
    key: "lesson_type",
    label: "Lesson type (automatic or manual)",
    ask: "Would you like automatic or manual lessons? The school offers both, and they cost the same. Not sure is fine.",
    kind: "lesson_type",
  },
  { key: "phone", label: "Phone number", ask: "What's the best phone number?" },
  { key: "pickup_postcode", label: "Pickup postcode", ask: "What's the postcode you'd like to be picked up from?" },
  {
    key: "lesson_availability",
    label: "Lesson availability",
    ask: "Which days and times could you do lessons?",
    max: 300,
  },
  {
    key: "theory_passed",
    label: "Theory test passed",
    ask: "Have you passed your theory test? Yes or no is fine.",
    kind: "yes_no",
  },
];

const ADI_PROFILE: EnquiryProfile = {
  clientId: "adi",
  availabilityFields: ADI_AVAILABILITY_FIELDS,
  tools: {
    save_lead: "lead",
    book_callback: "callback",
    leave_message: "message",
  },
  notifyTo: () => config.adiNotifyToEmail || undefined,
  notifyBcc: () => config.adiNotifyBccEmail || undefined,
  confirmations: {
    callback:
      "Callback saved. Confirm that someone from Formula Jon Driving School will call them. Do not invent a time they did not give.",
    message: "Message saved. Confirm it will be passed to the school.",
    lead: "Lead saved. Thank them and confirm someone from Formula Jon Driving School will follow up.",
  } satisfies Partial<Record<LeadType, string>>,
};

export function saveAdiEnquiry(input: {
  tool: string;
  args: Record<string, unknown>;
  conversationId: string;
  now?: Date;
  alreadySaved?: Set<string>;
}): Promise<EnquiryResult> {
  return saveMirraEnquiry(input, ADI_PROFILE);
}
