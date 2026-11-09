/**
 * Facts Amber may quote on the phone. Mirra's website chat uses this same
 * text, so a price or package change cannot land in one assistant only.
 * Wording that Amber already says stays here on purpose, including phone-only
 * lines such as transfer. Mirra's own instructions say how to treat those.
 */

export const AGENCY = {
  name: "Driving School Solutions",
  site: "drivingschoolsolutions.co.uk",
  siteUrl: "https://drivingschoolsolutions.co.uk",
  tagline: "Turn local searches into driving students.",
  phoneDisplay: "07356 281 666",
  email: "hello@drivingschoolsolutions.co.uk",
  office: "10 Waterloo Road, Sutton, London SM1 4LS",
  hours:
    "Monday to Friday, 9:00 am to 5:00 pm (Europe/London); closed Saturday and Sunday.",
  hoursConfirmed: "confirmed from the Google Business Profile, 5 Nov 2026",
  auditUrl: "https://drivingschoolsolutions.co.uk/free-local-seo-audit/",
} as const;

/** Service names Amber is told to prefer, in the approved order. */
export const SERVICE_NAMES =
  "Local SEO Strategy, Industry Link Building, Technical SEO & Audits, Website Design for Driving Schools, Google Maps, Social Media Management, Review Management, Google Business Profile, Website Hosting, Content Marketing, Generative Engine Optimisation, ADI Review Pack";

/** Prices either assistant may quote. Nothing else. */
export const PRICES = {
  websiteOffer: "£299.99",
  websiteOfferWas: "£599.99",
  websiteOfferEnds: "28 February 2027",
  independent: "£249.99",
  independentPlus: "£599.99",
  localSchool: "£799.99",
  franchise: "£1,099.99",
  seoStarter: "£129.99",
  seoGrowth: "£179.99",
  seoScale: "£249.99",
  dcPro: "£11.99",
  dcFranchise: "£13.99",
  dcExtra: "£9.99",
} as const;

/** Canonical pound amounts derived from PRICES, for checking a reply did not invent one. */
export function knownPriceAmounts(): Set<string> {
  const amounts = new Set<string>();
  for (const value of Object.values(PRICES)) {
    const match = /^£(\d{1,3}(?:,\d{3})*|\d+)\.(\d{2})$/.exec(value);
    if (!match) continue;
    amounts.add(`${match[1].replace(/,/g, "")}.${match[2]}`);
  }
  return amounts;
}

const KNOWN_PRICES = knownPriceAmounts();

/**
 * True when text states a pound amount that is not one of PRICES.
 * A dollar amount is treated the same way: the agency quotes pounds only.
 */
export function mentionsUnknownPrice(text: string): boolean {
  if (/\$\s?\d/.test(text)) return true;
  const re = /£\s?(\d{1,3}(?:,\d{3})*|\d+)(?:\.(\d{1,2}))?/g;
  for (const match of text.matchAll(re)) {
    const whole = match[1].replace(/,/g, "");
    const decimals = match[2];
    const canonical = decimals === undefined ? whole : `${whole}.${(decimals + "00").slice(0, 2)}`;
    if (!KNOWN_PRICES.has(canonical)) return true;
  }
  return false;
}

/** The block inserted into Amber's approved script, and into Mirra's instructions. */
export function sharedAgencyFacts(): string {
  return `## Tagline
${AGENCY.tagline}

## Who we help
- Independent ADIs and driving schools who want more local enquiries without relying on lead aggregators.
- If a learner or parent rings looking for driving lessons, politely explain this number is for Driving School Solutions (marketing and websites for instructors), take a message if useful, and end the call kindly. Do not quote lesson prices.

## Contact and hours (agency)
- Phone: ${AGENCY.phoneDisplay}
- Email: ${AGENCY.email}
- Office: ${AGENCY.office}
- Opening hours (${AGENCY.hoursConfirmed}): ${AGENCY.hours}
- During opening hours: you may transfer to a member of our team if the caller asks, after saying you are putting them through.
- Outside those hours (evenings, weekends and UK bank holidays): take a message only with leave_message (or save_lead / book_callback for the next working day). Do not call transfer_to_grant out of hours. Do not promise an immediate human reply.

## Free Local SEO Audit
Offer this when they want a look at their local search presence before spending. It is free. They get a short written report by email covering:
1. Google Business Profile (category, hours, service areas, photos, description, completeness)
2. Local rankings in their area
3. Their website on a phone (speed and whether it names the areas they cover)
4. Whether name, address and phone match across directories
Send them to ${AGENCY.auditUrl} or take their details and book a callback so a member of our team can send the report.

## Services and prices you may state
Only quote these. Do not invent others. If a price or package is not listed, say you will get a member of our team to confirm.

### Website Design for Driving Schools — limited-time five-page offer
- ${PRICES.websiteOffer}, normally ${PRICES.websiteOfferWas}. Offer ends ${PRICES.websiteOfferEnds}.
- One-off cost for a mobile-friendly five-page website (Home, About, Lessons & Pricing, Reviews, Contact).
- Price covers the design and build of five pages. Hosting, domain and extra pages are quoted separately. 50% deposit to start, 50% on completion.
- Typical build: about 2 to 4 weeks from having branding and basic details, longer if they need advanced booking or payment features.
- Once the final invoice is settled, they own the website, design and domain.

### Other published website plans (if they ask beyond the offer)
- The Independent: ${PRICES.independent} — one custom landing page, mobile responsive, contact form, Google Business Profile sync, secure hosting and SSL.
- The Independent Plus: ${PRICES.independentPlus} — up to five pages, basic SEO setup, domain, business email, one year cloud hosting and SSL, updates and backups (features as on the website; prices may vary with required features).
- Local Driving School: ${PRICES.localSchool} — up to ten pages plus Google Business Profile optimisation, technical SEO, Generative Engine Optimisation and review packs (as on the website).
- Franchise: ${PRICES.franchise} — larger set-up; offer a callback with a member of our team for detail.

### Monthly local SEO plans
- Starter: ${PRICES.seoStarter} per month (solo instructors; includes Google Business Profile optimisation, local keyword research, ADI Review Pack, one Google Business update per month, and related items as on the website).
- Growth: ${PRICES.seoGrowth} per month (small schools; two areas/locations and related extras as on the website).
- Scale: ${PRICES.seoScale} per month — for driving schools with 5 or more instructors (three areas/locations and related extras as on the website).
- Monthly plans can be cancelled with 30 days' written notice.
- Do not guarantee rankings; explain ethical, best-practice work over time.

### DualControl (instructor app)
- Starter: free, for up to 5 driving students.
- DC Pro: ${PRICES.dcPro} per month (solo instructor).
- Franchise: ${PRICES.dcFranchise} per month plus ${PRICES.dcExtra} per extra instructor.
- Brief description only beyond that; offer a callback for a walkthrough.

### AI Voice Receptionist
- The same kind of phone agent you are, for driving schools.
- A web page with full details is coming. Do not quote a price. Offer a callback with a member of our team.

### Also offered (brief description; exact package detail → callback)
- Local SEO Strategy and Google Business Profile management
- Social Media Management and Review Management / ADI Review Pack
- Website Hosting
- Content Marketing and Generative Engine Optimisation`;
}
