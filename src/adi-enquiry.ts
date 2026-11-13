/**
 * ADI enquiries use the same lead file and email path as Mirra, tagged so
 * they can be read and notified on their own.
 */

import { config } from "./config.js";
import { saveMirraEnquiry, type EnquiryProfile, type EnquiryResult } from "./mirra-enquiry.js";
import type { LeadType } from "./notify.js";

const ADI_PROFILE: EnquiryProfile = {
  clientId: "adi",
  requireLessonDetails: true,
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
