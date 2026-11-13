/**
 * ADI, the Formula Jon chat. Mounted at /adi so Mirra's paths stay put.
 */

import { config } from "./config.js";
import { adiPreviewHtml } from "./adi-preview.js";
import { saveAdiEnquiry } from "./adi-enquiry.js";
import {
  adiCardRefusal,
  adiContactFallback,
  adiGuardReply,
  adiInstructions,
  adiLengthLimitMessage,
  adiRateLimitMessage,
} from "./adi-prompt.js";
import { ADI_TOOLS } from "./adi-tools.js";
import { adiWidgetJs } from "./adi-widget.js";
import { createConversationStore } from "./mirra-chat.js";
import { createChatRouter, type ChatMount, type MirraRuntime } from "./mirra-routes.js";

export const FORMULA_JON_ORIGINS = [
  "https://formulajondrivingschool.co.uk",
  "https://www.formulajondrivingschool.co.uk",
];

const adiStore = createConversationStore();

const ADI_MOUNT: ChatMount = {
  id: "adi",
  logTag: "adi",
  widgetJs: adiWidgetJs,
  allowedOrigins: () => config.adiAllowedOrigins,
  allowLocalhost: () => config.adiAllowLocalhost,
  defaultOrigins: FORMULA_JON_ORIGINS,
  contactFallback: adiContactFallback,
  rateLimitMessage: adiRateLimitMessage,
  persona: {
    instructions: adiInstructions,
    saveEnquiry: saveAdiEnquiry,
    guardReply: adiGuardReply,
    cardRefusal: adiCardRefusal,
    lengthLimitMessage: adiLengthLimitMessage,
  },
  tools: ADI_TOOLS,
  leadsClient: "adi",
  ratePrefix: "ADI",
  previewHtml: adiPreviewHtml,
};

export function createAdiRouter(runtime: MirraRuntime = {}) {
  return createChatRouter(ADI_MOUNT, { store: adiStore, ...runtime });
}
