/** Tools Mirra may call. Shapes match the lead record Amber already stores. */

export const MIRRA_TOOLS = [
  {
    type: "function" as const,
    name: "save_lead",
    description:
      "Save a prospective ADI or driving school after they have agreed the summary. Need a name and a phone number or email.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Visitor's name" },
        phone: { type: "string", description: "Best phone number" },
        email: { type: "string", description: "Email address, if given" },
        business_type: {
          type: "string",
          enum: ["solo ADI", "driving school"],
          description: "Whether they are a solo ADI or a driving school",
        },
        school_or_area: { type: "string", description: "Area of the UK, and the school name if they have one" },
        interest: {
          type: "string",
          description: "What they need, such as a website, SEO, DualControl, or a Google Business Profile audit",
        },
        notes: { type: "string", description: "Any extra context they agreed you should pass on" },
      },
      required: ["name"],
    },
  },
  {
    type: "function" as const,
    name: "book_callback",
    description:
      "Book a callback with a member of the team after they have agreed. Need their name, phone number, and when they would like the call.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string" },
        phone: { type: "string" },
        email: { type: "string" },
        preferred_time: { type: "string", description: "When they would like a member of the team to call" },
        business_type: { type: "string", enum: ["solo ADI", "driving school"] },
        school_or_area: { type: "string" },
        notes: { type: "string" },
      },
      required: ["name", "phone", "preferred_time"],
    },
  },
  {
    type: "function" as const,
    name: "leave_message",
    description:
      "Pass a message to the team after they have agreed. Need their name, the message, and a phone number or email.",
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
  {
    type: "function" as const,
    name: "request_gbp_audit",
    description:
      "Request the free Google Business Profile audit (the free Local SEO Audit) after they have agreed. Need the business name, the town, and a phone number or email.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Contact name" },
        business_name: { type: "string", description: "Driving school or instructor business name" },
        town: { type: "string", description: "Town or area they cover" },
        gbp_url: {
          type: "string",
          description: "Google Business Profile link, only if they gave one",
        },
        phone: { type: "string" },
        email: { type: "string" },
        business_type: { type: "string", enum: ["solo ADI", "driving school"] },
        notes: { type: "string" },
      },
      required: ["business_name", "town"],
    },
  },
];
