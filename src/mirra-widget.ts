/**
 * The embeddable chat bubble. CSS lives in a shadow root so it does not
 * inherit Elementor rules or leak back onto the WordPress page.
 */

import { AGENCY } from "./agency-facts.js";
import { MIRRA_OPENING } from "./mirra-prompt.js";

export function mirraWidgetJs(options?: { maxMessageChars?: number }): string {
  const opening = JSON.stringify(MIRRA_OPENING);
  const maxChars = options?.maxMessageChars ?? 1500;
  const phone = JSON.stringify(AGENCY.phoneDisplay);

  return `/* Mirra — Driving School Solutions website chat. */
(function () {
  if (window.__mirraMounted) return;
  window.__mirraMounted = true;

  var OPENING = ${opening};
  var MAX_CHARS = ${maxChars};
  var PHONE = ${phone};
  var STORAGE_KEY = "mirra.conversation.v1";

  function apiBase() {
    var script = document.currentScript;
    if (!script) {
      var scripts = document.getElementsByTagName("script");
      for (var i = scripts.length - 1; i >= 0; i--) {
        if ((scripts[i].src || "").indexOf("/mirra/widget.js") !== -1) {
          script = scripts[i];
          break;
        }
      }
    }
    if (!script || !script.src) return "";
    return script.src.replace(/\\/mirra\\/widget\\.js(?:\\?.*)?$/, "");
  }

  function loadState() {
    try {
      var raw = window.sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.messages)) return null;
      return parsed;
    } catch (err) {
      return null;
    }
  }

  function saveState(state) {
    try {
      var messages = state.messages.slice(-40);
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
        conversationId: state.conversationId || "",
        messages: messages
      }));
    } catch (err) {
      /* Private browsing can block storage. The chat still works. */
    }
  }

  function mount() {
    if (!document.body) return;
    if (!document.getElementById("mirra-font") && document.head) {
      var font = document.createElement("link");
      font.id = "mirra-font";
      font.rel = "stylesheet";
      font.href = "https://fonts.googleapis.com/css2?family=Urbanist:wght@400;500;600;700&display=swap";
      document.head.appendChild(font);
    }

    var host = document.createElement("div");
    host.setAttribute("data-mirra", "widget");
    var shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = ${JSON.stringify(widgetMarkup(maxChars))};
    document.body.appendChild(host);

    var launcher = shadow.querySelector(".launcher");
    var panel = shadow.querySelector(".panel");
    var form = shadow.querySelector("form");
    var input = shadow.querySelector("textarea");
    var log = shadow.querySelector(".log");
    var closeButton = shadow.querySelector(".close");
    var sendButton = shadow.querySelector(".send");
    var status = shadow.querySelector("#mirra-status");
    if (!launcher || !panel || !form || !input || !log || !closeButton || !sendButton || !status) return;

    var base = apiBase();
    var stored = loadState();
    var state = {
      conversationId: stored && stored.conversationId ? stored.conversationId : "",
      messages: stored && stored.messages && stored.messages.length
        ? stored.messages
        : [{ role: "assistant", text: OPENING }],
      sending: false,
      closed: false
    };

    function persist() { saveState(state); }

    function render() {
      log.textContent = "";
      for (var i = 0; i < state.messages.length; i++) addMessage(state.messages[i], false);
      log.scrollTop = log.scrollHeight;
    }

    function addMessage(message, stick) {
      var item = document.createElement("div");
      item.className = "msg " + (message.role === "user" ? "user" : "assistant");
      item.setAttribute("role", "article");
      if (message.role === "user") {
        appendWithLinks(item, message.text);
      } else {
        item.appendChild(avatarClone());
        var bubble = document.createElement("div");
        bubble.className = "bubble";
        appendWithLinks(bubble, message.text);
        item.appendChild(bubble);
      }
      log.appendChild(item);
      if (stick !== false) log.scrollTop = log.scrollHeight;
    }

    function setOpen(open) {
      if (open) panel.removeAttribute("hidden");
      else panel.setAttribute("hidden", "");
      launcher.setAttribute("aria-expanded", open ? "true" : "false");
      if (open && !state.closed) input.focus();
      if (!open) launcher.focus();
    }

    function avatarClone() {
      var tpl = shadow.querySelector("#mirra-avatar");
      if (!tpl) return document.createElement("span");
      return tpl.content.cloneNode(true);
    }

    function setBusy(busy) {
      state.sending = busy;
      input.disabled = busy || state.closed;
      sendButton.disabled = busy || state.closed;
      status.textContent = busy ? "Mirra is replying." : "";
      host.classList.toggle("is-thinking", busy);
      var pending = log.querySelector(".msg.thinking");
      if (busy) {
        if (!pending) {
          var row = document.createElement("div");
          row.className = "msg assistant thinking";
          row.setAttribute("aria-hidden", "true");
          row.appendChild(avatarClone());
          log.appendChild(row);
          log.scrollTop = log.scrollHeight;
        }
      } else if (pending) {
        pending.remove();
      }
    }

    launcher.addEventListener("click", function () {
      var open = launcher.getAttribute("aria-expanded") === "true";
      setOpen(!open);
    });
    closeButton.addEventListener("click", function () { setOpen(false); });
    panel.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        event.stopPropagation();
        setOpen(false);
      }
    });

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      send();
    });
    input.addEventListener("keydown", function (event) {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        send();
      }
    });

    function send() {
      if (state.sending || state.closed) return;
      var text = (input.value || "").trim();
      if (!text) return;
      if (text.length > MAX_CHARS) {
        status.textContent = "Please shorten that message.";
        return;
      }
      input.value = "";
      state.messages.push({ role: "user", text: text });
      addMessage({ role: "user", text: text }, true);
      persist();
      setBusy(true);

      var controller = new AbortController();
      var timer = window.setTimeout(function () { controller.abort(); }, 50000);
      fetch(base + "/mirra/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, conversationId: state.conversationId || undefined }),
        signal: controller.signal
      }).then(function (response) {
        return response.json().catch(function () { return {}; }).then(function (payload) {
          return { ok: response.ok, status: response.status, payload: payload || {} };
        });
      }).then(function (result) {
        var payload = result.payload;
        if (payload.conversationId) state.conversationId = payload.conversationId;
        var reply = typeof payload.reply === "string" && payload.reply
          ? payload.reply
          : "Sorry, that didn't send. Please try again, or call " + PHONE + ".";
        if (payload.error === "card_details") {
          state.messages = state.messages.filter(function (message) { return message.text !== text; });
          render();
        }
        state.messages.push({ role: "assistant", text: reply });
        addMessage({ role: "assistant", text: reply }, true);
        if (payload.error === "length_limit") {
          state.closed = true;
          input.disabled = true;
          sendButton.disabled = true;
        }
        persist();
      }).catch(function () {
        var reply = "Sorry, that didn't send. Please try again, or call " + PHONE + ".";
        state.messages.push({ role: "assistant", text: reply });
        addMessage({ role: "assistant", text: reply }, true);
        persist();
      }).then(function () {
        window.clearTimeout(timer);
        setBusy(false);
      });
    }

    render();
    persist();
  }

  function appendWithLinks(node, text) {
    var re = /https:\\/\\/(?:www\\.)?drivingschoolsolutions\\.co\\.uk[^\\s)]*/g;
    var last = 0;
    var match;
    while ((match = re.exec(text))) {
      if (match.index > last) node.appendChild(document.createTextNode(text.slice(last, match.index)));
      var link = document.createElement("a");
      link.href = match[0];
      link.textContent = match[0];
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      node.appendChild(link);
      last = match.index + match[0].length;
    }
    if (last < text.length) node.appendChild(document.createTextNode(text.slice(last)));
  }

  if (document.body) mount();
  else document.addEventListener("DOMContentLoaded", mount);
})();
`;
}

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

function widgetMarkup(maxChars: number): string {
  return `<style>
@import url("https://fonts.googleapis.com/css2?family=Urbanist:wght@400;500;600;700&display=swap");
:host {
  all: initial;
  position: fixed;
  z-index: 2147483000;
  right: max(16px, env(safe-area-inset-right));
  bottom: max(16px, env(safe-area-inset-bottom));
  font-family: Urbanist, "Segoe UI", sans-serif;
  font-size: 16px;
  line-height: 1.45;
  color: #0b3665;
  color-scheme: light;
  display: block;
  width: 56px;
  height: 56px;
  pointer-events: none;
}
:host, :host * { box-sizing: border-box; }
.launcher, .panel { pointer-events: auto; }
button, textarea { font: inherit; color: inherit; }
button { cursor: pointer; }
.launcher, .panel { position: absolute; }
.launcher {
  right: 0;
  bottom: 0;
  width: 56px;
  height: 56px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: #fff;
  box-shadow: 0 8px 18px rgba(11, 54, 101, 0.28);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: visible;
}
.avatar { display: block; width: 28px; height: 28px; flex: none; overflow: visible; }
.launcher .avatar { width: 56px; height: 56px; }
.header .avatar { width: 36px; height: 36px; }
.avatar-bob, .eyes, .eye {
  transform-box: fill-box;
  transform-origin: center;
}
.avatar-bob { animation: mirra-breathe 3.6s ease-in-out infinite; }
.eyes { animation: mirra-glance 8s ease-in-out infinite; }
.eye { animation: mirra-blink 5.8s ease-in-out infinite; }
.signal { opacity: 0.55; }
.launcher:hover { box-shadow: 0 12px 26px rgba(11, 54, 101, 0.4); }
.launcher:hover .avatar-bob { animation-name: mirra-breathe-hover; }
.launcher:hover .avatar-face-shape { fill: #6aa0f4; stroke-width: 4.5; }
.launcher:active .avatar-bob { animation: none; transform: scale(0.94); }
:host(.is-thinking) .launcher .avatar-bob,
:host(.is-thinking) .header .avatar-bob,
:host(.is-thinking) .thinking .avatar-bob { animation: mirra-breathe 1.4s ease-in-out infinite; }
:host(.is-thinking) .launcher .eyes,
:host(.is-thinking) .header .eyes,
:host(.is-thinking) .thinking .eyes { animation: mirra-think 1.15s ease-in-out infinite; }
:host(.is-thinking) .signal { animation: mirra-signal 1.15s ease-in-out infinite; }
@keyframes mirra-breathe {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.045); }
}
@keyframes mirra-breathe-hover {
  0%, 100% { transform: scale(1.06); }
  50% { transform: scale(1.1); }
}
@keyframes mirra-glance {
  0%, 72%, 100% { transform: translateX(0); }
  80% { transform: translateX(-1.6px); }
  88% { transform: translateX(1.5px); }
}
@keyframes mirra-blink {
  0%, 84%, 100% { transform: scaleY(1); }
  89%, 93% { transform: scaleY(0.08); }
}
@keyframes mirra-think {
  0%, 100% { transform: translateX(-1.8px); }
  50% { transform: translateX(1.8px); }
}
@keyframes mirra-signal {
  0%, 100% { opacity: 0.3; }
  50% { opacity: 1; }
}
.panel {
  right: 0;
  bottom: 72px;
  width: min(380px, calc(100vw - 32px));
  height: min(560px, calc(100dvh - 96px));
  display: flex;
  flex-direction: column;
  background: #fff;
  color: #0b3665;
  border: 1px solid #d5deea;
  border-radius: 16px;
  overflow: hidden;
  box-shadow: 0 16px 40px rgba(11, 54, 101, 0.24);
}
.panel[hidden] { display: none !important; }
.header {
  background: #0b3665;
  color: #fff;
  padding: 14px 16px 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border-top: 4px solid #ff7851;
}
.who { display: flex; align-items: center; gap: 10px; min-width: 0; }
.title { margin: 0; font-size: 18px; line-height: 1.2; font-weight: 700; color: #fff; }
.subtitle { margin: 2px 0 0; font-size: 13px; color: #d6e4f7; }
.close {
  border: 0;
  background: transparent;
  color: #fff;
  font-weight: 600;
  min-height: 44px;
  min-width: 44px;
  padding: 8px;
}
.log {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  background: #fff;
}
.msg {
  max-width: 85%;
  padding: 10px 12px;
  border-radius: 12px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.msg.assistant {
  align-self: flex-start;
  display: flex;
  align-items: flex-end;
  gap: 8px;
  max-width: 92%;
  padding: 0;
  background: transparent;
  border: 0;
}
.msg.assistant .bubble {
  background: #f4f7fb;
  border: 1px solid #d5deea;
  border-left: 3px solid #8559e6;
  color: #0b3665;
  padding: 10px 12px;
  border-radius: 12px;
}
.msg.user { align-self: flex-end; background: #0b3665; color: #fff; }
.msg a { color: inherit; }
.composer {
  display: flex;
  gap: 8px;
  padding: 12px;
  border-top: 1px solid #d5deea;
  background: #fff;
}
textarea {
  flex: 1;
  resize: none;
  min-height: 44px;
  max-height: 96px;
  border: 1px solid #8aa0b8;
  border-radius: 10px;
  padding: 10px 12px;
  background: #fff;
  color: #0b3665;
}
.send {
  border: 0;
  border-radius: 10px;
  background: #0b3665;
  color: #fff;
  min-width: 72px;
  min-height: 44px;
  font-weight: 700;
}
.send:disabled, textarea:disabled { opacity: 0.6; cursor: not-allowed; }
.note {
  margin: 0;
  padding: 0 12px 12px;
  background: #fff;
  color: #3e5670;
  font-size: 12px;
}
.sr {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
:host :focus-visible { outline: 3px solid #8559e6; outline-offset: 2px; }
@media (prefers-reduced-motion: reduce) {
  :host, :host * { transition: none !important; animation: none !important; }
  .launcher:hover .avatar-bob,
  .launcher:active .avatar-bob { transform: none; }
}
</style>
<div class="launcher-wrap">
  <button type="button" class="launcher" aria-expanded="false" aria-controls="mirra-panel" aria-label="Chat with Mirra">
    ${AVATAR_SVG}
  </button>
  <section id="mirra-panel" class="panel" role="dialog" aria-modal="false" aria-labelledby="mirra-title" hidden>
    <header class="header">
      <div class="who">
        ${AVATAR_SVG}
        <div>
          <h2 id="mirra-title" class="title">Mirra</h2>
          <p class="subtitle">Driving School Solutions</p>
        </div>
      </div>
      <button type="button" class="close">Close</button>
    </header>
    <div class="log" role="log" aria-live="polite" aria-relevant="additions"></div>
    <form class="composer">
      <label class="sr" for="mirra-input">Message</label>
      <textarea id="mirra-input" maxlength="${maxChars}" rows="2" placeholder="Ask about websites, SEO, or a callback"></textarea>
      <button type="submit" class="send">Send</button>
    </form>
    <p class="note">Mirra is an AI assistant. Please don't send card details.</p>
    <div id="mirra-status" class="sr" role="status"></div>
  </section>
</div>
<template id="mirra-avatar">${AVATAR_SVG}</template>`;
}
