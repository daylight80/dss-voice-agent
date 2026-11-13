/** Tools ADI may call. Same jobs as Mirra's enquiry tools, in a pupil's words. */

export const ADI_TOOLS = [
  {
    type: "function" as const,
    name: "save_lead",
    description:
      "Save a pupil or parent enquiry after they have agreed the summary. Need a name, a phone number or email, the area or postcode, whether they want manual or automatic, and what they need.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Their name" },
        phone: { type: "string", description: "Best phone number" },
        email: { type: "string", description: "Email address, if given" },
        area: { type: "string", description: "Town, area, or postcode where they want lessons" },
        transmission: {
          type: "string",
          enum: ["manual", "automatic", "not sure"],
          description: "Manual, automatic, or not sure",
        },
        interest: { type: "string", description: "What they need, such as lessons for a beginner, a refresher, or a test day" },
        notes: { type: "string", description: "Any extra context they agreed you should pass on" },
      },
      required: ["name", "area", "transmission"],
    },
  },
  {
    type: "function" as const,
    name: "book_callback",
    description:
      "Book a callback from Formula Jon Driving School after they have agreed. Need their name, phone number, when they would like the call, their area, and manual or automatic.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string" },
        phone: { type: "string" },
        email: { type: "string" },
        preferred_time: { type: "string", description: "When they would like the school to call" },
        area: { type: "string", description: "Town, area, or postcode" },
        transmission: {
          type: "string",
          enum: ["manual", "automatic", "not sure"],
        },
        notes: { type: "string" },
      },
      required: ["name", "phone", "preferred_time", "area", "transmission"],
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
        area: { type: "string" },
        transmission: {
          type: "string",
          enum: ["manual", "automatic", "not sure"],
        },
      },
      required: ["name", "message"],
    },
  },
];
