/** Tool definitions sent in session.update for Amber. */

const lessonEnquiryFields = {
  postcode: {
    type: "string",
    description:
      "Postcode for a driving-lesson enquiry, if they give one. Optional. Omit it if they do not know it or would rather not say.",
  },
  theory_test_status: {
    type: "string",
    description:
      "Theory test for a driving-lesson enquiry: yes, no, booked, or not sure. Optional. Omit it if it was not discussed.",
  },
};

export const AMBER_TOOLS = [
  {
    type: "function" as const,
    name: "save_lead",
    description:
      "Save a qualified lead (prospective ADI or driving school). Call after you have at least a name and a phone or email.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Caller's full name" },
        phone: { type: "string", description: "Best phone number in E.164 if possible" },
        email: { type: "string", description: "Email address if given" },
        ...lessonEnquiryFields,
        interest: {
          type: "string",
          description:
            "What they need, e.g. website, SEO, DualControl, AI Voice Receptionist, GBP",
        },
        school_or_area: {
          type: "string",
          description: "School name and/or area of the UK",
        },
        notes: { type: "string", description: "Any extra context from the call" },
      },
      required: ["name"],
    },
  },
  {
    type: "function" as const,
    name: "book_callback",
    description:
      "Book a callback with a member of our team. Prefer a concrete preferred time if the caller gives one.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string" },
        phone: { type: "string" },
        ...lessonEnquiryFields,
        preferred_time: {
          type: "string",
          description: "When they would like a member of our team to call back",
        },
        notes: { type: "string" },
      },
      required: ["name", "phone"],
    },
  },
  {
    type: "function" as const,
    name: "leave_message",
    description: "Leave a message that will be emailed to the team.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string" },
        phone: { type: "string" },
        ...lessonEnquiryFields,
        message: { type: "string", description: "The message to pass on" },
      },
      required: ["name", "message"],
    },
  },
  {
    type: "function" as const,
    name: "transfer_to_grant",
    description:
      "Transfer this live call to a member of our team. Tell the caller you are putting them through first, then call this tool.",
    parameters: {
      type: "object",
      properties: {
        reason: {
          type: "string",
          description: "Short reason for the transfer",
        },
      },
      required: [],
    },
  },
];

export type ToolName =
  | "save_lead"
  | "book_callback"
  | "leave_message"
  | "transfer_to_grant";
