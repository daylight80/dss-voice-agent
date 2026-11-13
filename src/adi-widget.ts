/**
 * ADI's embed for Formula Jon Driving School. Same bubble behaviour as Mirra.
 * Colours and type come from the live site's CSS (13 November 2026):
 * --theme-color rgb(224, 22, 9), --title-color #191825, --smoke-color #F7F7F7,
 * Raleway for headings and Roboto for text. The cap panel uses the logo cream
 * #ECEBD7 so the cap stays readable at launcher size.
 */

import { renderChatWidget, type ChatWidgetSpec } from "./chat-widget.js";
import { ADI_OPENING } from "./adi-prompt.js";

/**
 * A friendly face in a baseball cap. The brim runs almost the full width of
 * the icon so it still reads as a cap at 56px.
 */
const AVATAR_SVG = `<svg class="avatar" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
  <g class="avatar-bob">
    <circle class="avatar-face-shape" cx="32" cy="34" r="24" fill="#F6D3B0" stroke="#E01609" stroke-width="3"></circle>
    <path d="M16 33c1.4-13 7.6-20 16-20s14.6 7 16 20H16z" fill="#E01609"></path>
    <path d="M23 18.2c1.5-4.4 5.2-6.6 9-6.6s7.5 2.2 9 6.6v6.4c-2 2.2-5.4 3.4-9 3.4s-7-1.2-9-3.4v-6.4z" fill="#ECEBD7"></path>
    <circle cx="32" cy="14.6" r="2.4" fill="#ECEBD7" stroke="#E01609" stroke-width="1.1"></circle>
    <path d="M18.5 31.5c1.2 3.2 2.2 5.2 2.2 5.2" fill="none" stroke="#191825" stroke-width="2.4" stroke-linecap="round"></path>
    <path d="M45.5 31.5c-1.2 3.2-2.2 5.2-2.2 5.2" fill="none" stroke="#191825" stroke-width="2.4" stroke-linecap="round"></path>
    <ellipse cx="32" cy="32.5" rx="27" ry="6.4" fill="#E01609"></ellipse>
    <path d="M6.5 33.2c3.2 4.2 13 6.6 25.5 6.6s22.3-2.4 25.5-6.6" fill="none" stroke="#191825" stroke-width="2.4" stroke-linecap="round"></path>
    <g class="eyes">
      <g class="eye">
        <ellipse cx="24.2" cy="43.2" rx="3.2" ry="3.6" fill="#191825"></ellipse>
        <circle cx="25.3" cy="42" r="1.1" fill="#ffffff"></circle>
      </g>
      <g class="eye">
        <ellipse cx="39.8" cy="43.2" rx="3.2" ry="3.6" fill="#191825"></ellipse>
        <circle cx="40.9" cy="42" r="1.1" fill="#ffffff"></circle>
      </g>
    </g>
    <path class="smile smile-rest" d="M26.4 50.4c1.6 2.2 3.6 3.3 5.6 3.3s4-1.1 5.6-3.3" fill="none" stroke="#191825" stroke-width="2" stroke-linecap="round"></path>
    <path class="smile smile-big" d="M22.6 48.8c2.8 5.4 7 7.6 9.4 7.6s6.6-2.2 9.4-7.6" fill="none" stroke="#191825" stroke-width="2.2" stroke-linecap="round"></path>
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
