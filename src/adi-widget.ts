/**
 * ADI's embed for Formula Jon Driving School. Same bubble behaviour as Mirra.
 * Colours and type come from the live site's CSS (13 November 2026):
 * --theme-color rgb(224, 22, 9), --title-color #191825, --smoke-color #F7F7F7,
 * Raleway for headings and Roboto for text. The beanie is Formula Jon red
 * with a cream band and bobble so it still reads at launcher size.
 */

import { renderChatWidget, type ChatWidgetSpec } from "./chat-widget.js";
import { ADI_OPENING } from "./adi-prompt.js";

/**
 * An original flat paper-cut face. Chunky and a little wide, with dot eyes
 * in white ovals. The red bobble beanie covers the top and sides; the cream
 * ribbed band and bobble stay visible at 56px. Not based on any existing character.
 */
const AVATAR_SVG = `<svg class="avatar" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
  <g class="avatar-bob">
    <ellipse class="avatar-face-shape" cx="32" cy="38" rx="28" ry="24" fill="#F3C29A"></ellipse>
    <path d="M5 30c0-16 11-26 27-26s27 10 27 26v6H5z" fill="#E01609"></path>
    <circle class="bobble" cx="32" cy="8" r="6.2" fill="#ECEBD7"></circle>
    <rect class="beanie-band" x="5" y="28" width="54" height="11" fill="#ECEBD7"></rect>
    <path d="M10 28v11M16 28v11M22 28v11M28 28v11M34 28v11M40 28v11M46 28v11M52 28v11" fill="none" stroke="#C4B48A" stroke-width="1.6"></path>
    <ellipse cx="16" cy="48" rx="4.2" ry="2.5" fill="#E7A090"></ellipse>
    <ellipse cx="48" cy="48" rx="4.2" ry="2.5" fill="#E7A090"></ellipse>
    <g class="eyes">
      <g class="eye">
        <ellipse cx="23" cy="47" rx="5.6" ry="6.4" fill="#ffffff"></ellipse>
        <circle cx="23" cy="48.2" r="2.3" fill="#191825"></circle>
      </g>
      <g class="eye">
        <ellipse cx="41" cy="47" rx="5.6" ry="6.4" fill="#ffffff"></ellipse>
        <circle cx="41" cy="48.2" r="2.3" fill="#191825"></circle>
      </g>
    </g>
    <path class="smile smile-rest" d="M27 56.2c1.6 1.8 3.4 2.6 5 2.6s3.4-.8 5-2.6" fill="none" stroke="#191825" stroke-width="2.2" stroke-linecap="round"></path>
    <path class="smile smile-big" d="M22 54.5c2.8 4.8 6.2 6.6 10 6.6s7.2-1.8 10-6.6" fill="none" stroke="#191825" stroke-width="2.4" stroke-linecap="round"></path>
  </g>
</svg>`;

const ADI_WIDGET: ChatWidgetSpec = {
  id: "adi",
  opening: ADI_OPENING,
  phoneDisplay: "07790 779 687 or 0330 043 6002",
  fontStylesheet:
    "https://fonts.googleapis.com/css2?family=Raleway:wght@600;700;800&family=Roboto:wght@400;500;700&display=swap",
  fontFamily: 'Roboto, "Segoe UI", sans-serif',
  titleFontFamily: 'Raleway, Roboto, "Segoe UI", sans-serif',
  text: "#191825",
  headerBg: "#E01609",
  headerText: "#ffffff",
  headerSub: "#ffffff",
  accentTop: "#191825",
  accentBubble: "#E01609",
  assistantBg: "#F7F7F7",
  panelBg: "#ffffff",
  border: "#E6E6E6",
  note: "#54595F",
  inputBorder: "#54595F",
  focus: "#191825",
  shadowRgb: "25, 24, 37",
  hoverFace: "#F8DCC4",
  avatarSvg: AVATAR_SVG,
  title: "ADI",
  subtitle: "Formula Jon Driving School",
  placeholder: "Ask about lessons, prices, or a callback",
  disclaimer: "ADI is an AI assistant. Please don't send card details.",
  launcherLabel: "Chat with ADI",
  busyStatus: "ADI is replying.",
  linkHost: "formulajondrivingschool.co.uk",
  scriptPath: "/adi/widget.js",
  bannerComment: "ADI — Formula Jon Driving School website chat.",
  expression: "adi",
};

export function adiWidgetJs(options?: { maxMessageChars?: number }): string {
  return renderChatWidget(ADI_WIDGET, options);
}
