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
 * A friendly face in a baseball cap, turned a little so the peak reads at
 * 56px. The peak sticks out over the forehead only. There is no brim around
 * the sides or the back.
 */
const AVATAR_SVG = `<svg class="avatar" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
  <g class="avatar-bob">
    <path d="M15 40c0 8 4 15 10 16" fill="none" stroke="#191825" stroke-width="2.2" stroke-linecap="round"></path>
    <circle class="avatar-face-shape" cx="30" cy="42" r="17.2" fill="#F6D3B0" stroke="#E01609" stroke-width="2.2"></circle>
    <path d="M16 33.5C16 19 22 13 31.5 13c9.2 0 15.2 6 15.2 16.2 0 2.2-.4 3.6-1.2 4.6-8.2-2.4-20.6-2.2-29.5-.3z" fill="#E01609"></path>
    <path d="M31.5 15.2c-2.2 6.2-5 11.6-8.4 16.6" fill="none" stroke="#7A0C08" stroke-width="1.15" stroke-linecap="round"></path>
    <path d="M31.5 15.2c2.4 6.4 5.6 11.4 9.6 16" fill="none" stroke="#7A0C08" stroke-width="1.15" stroke-linecap="round"></path>
    <path d="M31.5 15.2c-.4 6.6-.8 12-1.2 16.8" fill="none" stroke="#7A0C08" stroke-width="1.15" stroke-linecap="round"></path>
    <circle cx="31.5" cy="14.4" r="1.7" fill="#ECEBD7" stroke="#E01609" stroke-width="0.6"></circle>
    <ellipse cx="33.5" cy="24.2" rx="4.2" ry="3.1" fill="#ECEBD7"></ellipse>
    <path class="peak" d="M22 32.5c6.5-1.2 14-.4 20.5 2.2 8 3.2 14.5 7.5 12.2 12.2-7.2-2.2-16.8-5.6-26.4-7.2-4.6-.8-7.8-3.6-6.3-7.2z" fill="#ECEBD7"></path>
    <path class="peak" d="M23.5 32.2c6.2-1 13-.2 18.8 1.8 6.2 2.2 10.2 4.6 8.6 7.6-6-1.6-14.2-4-22.4-5.4-3.6-.6-6.2-2.4-5-4z" fill="#E01609"></path>
    <g class="eyes">
      <g class="eye">
        <ellipse cx="25.2" cy="46.2" rx="3" ry="3.3" fill="#191825"></ellipse>
        <circle cx="26.2" cy="45.1" r="1" fill="#ffffff"></circle>
      </g>
      <g class="eye">
        <ellipse cx="36.4" cy="45.6" rx="3" ry="3.3" fill="#191825"></ellipse>
        <circle cx="37.4" cy="44.5" r="1" fill="#ffffff"></circle>
      </g>
    </g>
    <path class="smile smile-rest" d="M26.6 53.2c1.4 1.9 3.2 2.9 5 2.9s3.5-1 4.9-2.9" fill="none" stroke="#191825" stroke-width="2" stroke-linecap="round"></path>
    <path class="smile smile-big" d="M23.2 51.8c2.3 4.6 5.6 6.3 8.2 6.3s5.9-1.7 8.2-6.3" fill="none" stroke="#191825" stroke-width="2.2" stroke-linecap="round"></path>
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
