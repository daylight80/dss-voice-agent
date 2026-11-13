/** Tools ADI may call. The availability questions come from the client field list. */

import { ADI_AVAILABILITY_FIELDS } from "./adi-enquiry.js";
import type { EnquiryField } from "./mirra-enquiry.js";

export const ADI_TOOLS = [
  {
    type: "function" as const,
    name: "save_lead",
    description:
      "Save a lesson-availability enquiry after they have agreed the summary. Pass whichever of the availability details they gave. Omit any they would rather not share. Still call this when the list is incomplete.",
    parameters: availabilityParameters(),
  },
  {
    type: "function" as const,
    name: "book_callback",
    description:
      "Book a callback from Formula Jon Driving School after they have agreed. Need their name, phone number, and when they would like the call.",
    parameters: {
      type: "object",
      properties: {
        ...availabilityProperties(ADI_AVAILABILITY_FIELDS),
        email: { type: "string" },
        preferred_time: { type: "string", description: "When they would like the school to call" },
        transmission: {
          type: "string",
          enum: ["manual", "automatic", "not sure"],
        },
        notes: { type: "string" },
      },
      required: ["name", "phone", "preferred_time"],
    },
  },
  {
    type: "function" as const,
    name: "leave_message",
    description:
      "Pass a message to the school after they have agreed. Need their name, the message, and a phone number or email.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string" },
        phone: { type: "string" },
        email: { type: "string" },
        message: { type: "string", description: "The message to pass on" },
      },
      required: ["name", "message"],
    },
  },
];

function availabilityParameters(): {
  type: "object";
  properties: Record<string, unknown>;
  required: string[];
} {
  return {
    type: "object",
    properties: {
      ...availabilityProperties(ADI_AVAILABILITY_FIELDS),
      email: { type: "string", description: "Email address, if they gave one" },
      transmission: {
        type: "string",
        enum: ["manual", "automatic", "not sure"],
        description: "Manual, automatic, or not sure, only if they said",
      },
      interest: { type: "string", description: "What they need, if they said more than a general lesson enquiry" },
      notes: { type: "string" },
    },
    required: [],
  };
}

function availabilityProperties(fields: EnquiryField[]): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  for (const field of fields) {
    properties[field.key] = {
      type: "string",
      description: field.kind === "yes_no" ? `${field.label}. Yes or no.` : field.ask,
    };
  }
  return properties;
}
