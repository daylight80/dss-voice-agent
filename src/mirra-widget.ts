/**
 * Mirra's embed. The colours, type, opening line and bottom-left position
 * are the ones already on drivingschoolsolutions.co.uk.
 */

import { AGENCY } from "./agency-facts.js";
import { renderChatWidget, type ChatWidgetSpec } from "./chat-widget.js";
import { MIRRA_OPENING } from "./mirra-prompt.js";

/** Original face: a blue orb whose eyes are rear-view mirrors. Not a copy of any logo. */
const AVATAR_SVG = `<svg class="avatar" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
  <g class="avatar-bob">
    <circle class="avatar-face-shape" cx="32" cy="32" r="25.5" fill="#4786ee" stroke="#ff7851" stroke-width="3"></circle>
    <circle cx="22.5" cy="19" r="6.5" fill="#ffffff" opacity="0.18"></circle>
    <g class="eyes">
      <g class="eye">
        <g transform="rotate(-7 22 31)">
          <rect x="13" y="25" width="18" height="11" rx="3.6" fill="#0b3665"></rect>
          <rect class="eye-glass" x="15" y="27" width="14" height="7" rx="2.2" fill="#f4f7fb"></rect>
          <rect x="16.2" y="28.1" width="4" height="3" rx="1" fill="#8559e6"></rect>
          <rect x="20.4" y="35.4" width="3.2" height="3.6" rx="1.4" fill="#0b3665"></rect>
        </g>
      </g>
      <g class="eye">
        <g transform="rotate(7 42 31)">
          <rect x="33" y="25" width="18" height="11" rx="3.6" fill="#0b3665"></rect>
          <rect class="eye-glass" x="35" y="27" width="14" height="7" rx="2.2" fill="#f4f7fb"></rect>
          <rect x="43.4" y="28.1" width="4" height="3" rx="1" fill="#ffffff"></rect>
          <circle class="signal" cx="47" cy="23.2" r="2.7" fill="#ff7851"></circle>
          <rect x="40.4" y="35.4" width="3.2" height="3.6" rx="1.4" fill="#0b3665"></rect>
        </g>
      </g>
    </g>
    <path class="smile" d="M23.5 45.2c2.6 3.5 6 5.1 8.5 5.1s5.9-1.6 8.5-5.1" fill="none" stroke="#0b3665" stroke-width="2.3" stroke-linecap="round"></path>
  </g>
</svg>`;

const MIRRA_WIDGET: ChatWidgetSpec = {
  id: "mirra",
  opening: MIRRA_OPENING,
  phoneDisplay: AGENCY.phoneDisplay,
  fontStylesheet: "https://fonts.googleapis.com/css2?family=Urbanist:wght@400;500;600;700&display=swap",
  fontFamily: 'Urbanist, "Segoe UI", sans-serif',
  titleFontFamily: 'Urbanist, "Segoe UI", sans-serif',
  text: "#0b3665",
  headerBg: "#0b3665",
  headerText: "#fff",
  headerSub: "#d6e4f7",
  accentTop: "#ff7851",
  accentBubble: "#8559e6",
  assistantBg: "#f4f7fb",
  panelBg: "#fff",
  border: "#d5deea",
  note: "#3e5670",
  inputBorder: "#8aa0b8",
  focus: "#8559e6",
  shadowRgb: "11, 54, 101",
  hoverFace: "#6aa0f4",
  avatarSvg: AVATAR_SVG,
  title: "Mirra",
  subtitle: "Driving School Solutions",
  placeholder: "Ask about websites, SEO, or a callback",
  disclaimer: "Mirra is an AI assistant. Please don't send card details.",
  launcherLabel: "Chat with Mirra",
  busyStatus: "Mirra is replying.",
  linkHost: "drivingschoolsolutions.co.uk",
  scriptPath: "/mirra/widget.js",
  bannerComment: "Mirra — Driving School Solutions website chat.",
};

export function mirraWidgetJs(options?: { maxMessageChars?: number }): string {
  return renderChatWidget(MIRRA_WIDGET, options);
}
