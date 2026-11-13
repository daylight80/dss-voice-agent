/**
 * One shadow-DOM chat bubble, skinned per client. Mirra's spec keeps the
 * colours, type and opening line already on drivingschoolsolutions.co.uk.
 */

export type ChatWidgetSpec = {
  id: string;
  opening: string;
  phoneDisplay: string;
  fontStylesheet: string;
  fontFamily: string;
  titleFontFamily: string;
  text: string;
  headerBg: string;
  headerText: string;
  headerSub: string;
  accentTop: string;
  accentBubble: string;
  assistantBg: string;
  panelBg: string;
  border: string;
  note: string;
  inputBorder: string;
  focus: string;
  /** "r, g, b" used in the launcher and panel shadows. */
  shadowRgb: string;
  hoverFace: string;
  avatarSvg: string;
  title: string;
  subtitle: string;
  placeholder: string;
  disclaimer: string;
  launcherLabel: string;
  busyStatus: string;
  /** Hostname whose links in a reply become anchors. No scheme, no www. */
  linkHost: string;
  /** Path the embed is served from, such as /mirra/widget.js. */
  scriptPath: string;
  bannerComment: string;
  /**
   * ADI blinks at a slightly random gap and smiles when the chat opens,
   * when he replies, and while the launcher is hovered. Mirra leaves this unset.
   */
  expression?: "adi";
  /**
   * How far the launcher sits above the bottom of the page. The open panel
   * moves with it. Mirra leaves this unset and stays at 16.
   */
  bottomOffsetPx?: number;
};

export function renderChatWidget(spec: ChatWidgetSpec, options?: { maxMessageChars?: number }): string {
  const maxChars = options?.maxMessageChars ?? 1500;
  const opening = JSON.stringify(spec.opening);
  const phone = JSON.stringify(spec.phoneDisplay);
  const busy = JSON.stringify(spec.busyStatus);
  const host = jsRegExpSource(spec.linkHost);
  const scriptRe = jsRegExpSource(spec.scriptPath);
  const adi = spec.expression === "adi";

  return `/* ${spec.bannerComment} */
(function () {
  if (window.__${spec.id}Mounted) return;
  window.__${spec.id}Mounted = true;

  var OPENING = ${opening};
  var MAX_CHARS = ${maxChars};
  var PHONE = ${phone};
  var BUSY = ${busy};
  var STORAGE_KEY = ${JSON.stringify(`${spec.id}.conversation.v1`)};

  function apiBase() {
    var script = document.currentScript;
    if (!script) {
      var scripts = document.getElementsByTagName("script");
      for (var i = scripts.length - 1; i >= 0; i--) {
        if ((scripts[i].src || "").indexOf(${JSON.stringify(spec.scriptPath)}) !== -1) {
          script = scripts[i];
          break;
        }
      }
    }
    if (!script || !script.src) return "";
    return script.src.replace(/${scriptRe}(?:\\?.*)?$/, "");
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
    var fontId = ${JSON.stringify(`${spec.id}-font`)};
    if (!document.getElementById(fontId) && document.head) {
      var font = document.createElement("link");
      font.id = fontId;
      font.rel = "stylesheet";
      font.href = ${JSON.stringify(spec.fontStylesheet)};
      document.head.appendChild(font);
    }

    var host = document.createElement("div");
    host.setAttribute(${JSON.stringify(`data-${spec.id}`)}, "widget");
    var shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = ${JSON.stringify(widgetMarkup(spec, maxChars))};
    document.body.appendChild(host);

    var launcher = shadow.querySelector(".launcher");
    var panel = shadow.querySelector(".panel");
    var form = shadow.querySelector("form");
    var input = shadow.querySelector("textarea");
    var log = shadow.querySelector(".log");
    var closeButton = shadow.querySelector(".close");
    var sendButton = shadow.querySelector(".send");
    var status = shadow.querySelector(${JSON.stringify(`#${spec.id}-status`)});
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
      ${adi ? "if (message.role !== \"user\") watchBlinks(item);\n      if (stick !== false && message.role === \"assistant\") please();" : ""}
    }

    function setOpen(open) {
      if (open) panel.removeAttribute("hidden");
      else panel.setAttribute("hidden", "");
      ${adi ? "if (open) please();" : ""}
      launcher.setAttribute("aria-expanded", open ? "true" : "false");
      if (open && !state.closed) input.focus();
      if (!open) launcher.focus();
    }

    function avatarClone() {
      var tpl = shadow.querySelector(${JSON.stringify(`#${spec.id}-avatar`)});
      if (!tpl) return document.createElement("span");
      return tpl.content.cloneNode(true);
    }

    function setBusy(busy) {
      state.sending = busy;
      input.disabled = busy || state.closed;
      sendButton.disabled = busy || state.closed;
      status.textContent = busy ? BUSY : "";
      host.classList.toggle("is-thinking", busy);
      var pending = log.querySelector(".msg.thinking");
      if (busy) {
        if (!pending) {
          var row = document.createElement("div");
          row.className = "msg assistant thinking";
          row.setAttribute("aria-hidden", "true");
          row.appendChild(avatarClone());
          ${adi ? "watchBlinks(row);" : ""}
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
      fetch(base + ${JSON.stringify(`/${spec.id}/chat`)}, {
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

    ${adi ? ADI_EXPRESSION_JS : ""}
    render();
    persist();
    ${adi ? "watchBlinks(shadow);" : ""}
  }

  function appendWithLinks(node, text) {
    var re = /https:\\/\\/(?:www\\.)?${host}[^\\s)]*/g;
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

function widgetMarkup(spec: ChatWidgetSpec, maxChars: number): string {
  const prefix = spec.id;
  const bottomOffset = spec.bottomOffsetPx ?? 16;
  return `<style>
@import url("${spec.fontStylesheet}");
:host {
  all: initial;
  position: fixed;
  z-index: 2147483000;
  left: max(16px, env(safe-area-inset-left));
  bottom: max(${bottomOffset}px, env(safe-area-inset-bottom));
  font-family: ${spec.fontFamily};
  font-size: 16px;
  line-height: 1.45;
  color: ${spec.text};
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
  left: 0;
  bottom: 0;
  width: 56px;
  height: 56px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: #fff;
  box-shadow: 0 8px 18px rgba(${spec.shadowRgb}, 0.28);
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
.avatar-bob { animation: ${prefix}-breathe 3.6s ease-in-out infinite; }
.eyes { animation: ${prefix}-glance 8s ease-in-out infinite; }
.eye { animation: ${prefix}-blink 5.8s ease-in-out infinite; }
.signal { opacity: 0.55; }
.launcher:hover { box-shadow: 0 12px 26px rgba(${spec.shadowRgb}, 0.4); }
.launcher:hover .avatar-bob { animation-name: ${prefix}-breathe-hover; }
.launcher:hover .avatar-face-shape { fill: ${spec.hoverFace}; stroke-width: 4.5; }
.launcher:active .avatar-bob { animation: none; transform: scale(0.94); }
:host(.is-thinking) .launcher .avatar-bob,
:host(.is-thinking) .header .avatar-bob,
:host(.is-thinking) .thinking .avatar-bob { animation: ${prefix}-breathe 1.4s ease-in-out infinite; }
:host(.is-thinking) .launcher .eyes,
:host(.is-thinking) .header .eyes,
:host(.is-thinking) .thinking .eyes { animation: ${prefix}-think 1.15s ease-in-out infinite; }
:host(.is-thinking) .signal { animation: ${prefix}-signal 1.15s ease-in-out infinite; }
@keyframes ${prefix}-breathe {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.045); }
}
@keyframes ${prefix}-breathe-hover {
  0%, 100% { transform: scale(1.06); }
  50% { transform: scale(1.1); }
}
@keyframes ${prefix}-glance {
  0%, 72%, 100% { transform: translateX(0); }
  80% { transform: translateX(-1.6px); }
  88% { transform: translateX(1.5px); }
}
@keyframes ${prefix}-blink {
  0%, 84%, 100% { transform: scaleY(1); }
  89%, 93% { transform: scaleY(0.08); }
}
@keyframes ${prefix}-think {
  0%, 100% { transform: translateX(-1.8px); }
  50% { transform: translateX(1.8px); }
}
@keyframes ${prefix}-signal {
  0%, 100% { opacity: 0.3; }
  50% { opacity: 1; }
}
.panel {
  left: 0;
  bottom: 72px;
  width: min(380px, calc(100vw - 32px));
  height: min(560px, calc(100dvh - ${bottomOffset + 80}px));
  display: flex;
  flex-direction: column;
  background: ${spec.panelBg};
  color: ${spec.text};
  border: 1px solid ${spec.border};
  border-radius: 16px;
  overflow: hidden;
  box-shadow: 0 16px 40px rgba(${spec.shadowRgb}, 0.24);
}
.panel[hidden] { display: none !important; }
.header {
  background: ${spec.headerBg};
  color: ${spec.headerText};
  padding: 14px 16px 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border-top: 4px solid ${spec.accentTop};
}
.who { display: flex; align-items: center; gap: 10px; min-width: 0; }
.title { margin: 0; font-family: ${spec.titleFontFamily}; font-size: 18px; line-height: 1.2; font-weight: 700; color: ${spec.headerText}; }
.subtitle { margin: 2px 0 0; font-size: 13px; color: ${spec.headerSub}; }
.close {
  border: 0;
  background: transparent;
  color: ${spec.headerText};
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
  background: ${spec.panelBg};
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
  background: ${spec.assistantBg};
  border: 1px solid ${spec.border};
  border-left: 3px solid ${spec.accentBubble};
  color: ${spec.text};
  padding: 10px 12px;
  border-radius: 12px;
}
.msg.user { align-self: flex-end; background: ${spec.headerBg}; color: ${spec.headerText}; }
.msg a { color: inherit; }
.composer {
  display: flex;
  gap: 8px;
  padding: 12px;
  border-top: 1px solid ${spec.border};
  background: ${spec.panelBg};
}
textarea {
  flex: 1;
  resize: none;
  min-height: 44px;
  max-height: 96px;
  border: 1px solid ${spec.inputBorder};
  border-radius: 10px;
  padding: 10px 12px;
  background: ${spec.panelBg};
  color: ${spec.text};
}
.send {
  border: 0;
  border-radius: 10px;
  background: ${spec.headerBg};
  color: ${spec.headerText};
  min-width: 72px;
  min-height: 44px;
  font-weight: 700;
}
.send:disabled, textarea:disabled { opacity: 0.6; cursor: not-allowed; }
.note {
  margin: 0;
  padding: 0 12px 12px;
  background: ${spec.panelBg};
  color: ${spec.note};
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
:host :focus-visible { outline: 3px solid ${spec.focus}; outline-offset: 2px; }
${spec.expression === "adi" ? ADI_EXPRESSION_CSS : ""}
@media (prefers-reduced-motion: reduce) {
  :host, :host * { transition: none !important; animation: none !important; }
  .launcher:hover .avatar-bob,
  .launcher:active .avatar-bob { transform: none; }
}
</style>
<div class="launcher-wrap">
  <button type="button" class="launcher" aria-expanded="false" aria-controls="${spec.id}-panel" aria-label="${escapeAttr(spec.launcherLabel)}">
    ${spec.avatarSvg}
  </button>
  <section id="${spec.id}-panel" class="panel" role="dialog" aria-modal="false" aria-labelledby="${spec.id}-title" hidden>
    <header class="header">
      <div class="who">
        ${spec.avatarSvg}
        <div>
          <h2 id="${spec.id}-title" class="title">${escapeText(spec.title)}</h2>
          <p class="subtitle">${escapeText(spec.subtitle)}</p>
        </div>
      </div>
      <button type="button" class="close">Close</button>
    </header>
    <div class="log" role="log" aria-live="polite" aria-relevant="additions"></div>
    <form class="composer">
      <label class="sr" for="${spec.id}-input">Message</label>
      <textarea id="${spec.id}-input" maxlength="${maxChars}" rows="2" placeholder="${escapeAttr(spec.placeholder)}"></textarea>
      <button type="submit" class="send">Send</button>
    </form>
    <p class="note">${escapeText(spec.disclaimer)}</p>
    <div id="${spec.id}-status" class="sr" role="status"></div>
  </section>
</div>
<template id="${spec.id}-avatar">${spec.avatarSvg}</template>`;
}

/**
 * ADI only. A blink every 3 to 6 seconds, and a short bigger smile when the
 * panel opens or a reply arrives. Hover is handled in CSS. Reduced motion
 * skips both.
 */
const ADI_EXPRESSION_JS = `var pleaseTimer = 0;
    function please() {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      host.classList.add("is-pleased");
      window.clearTimeout(pleaseTimer);
      pleaseTimer = window.setTimeout(function () { host.classList.remove("is-pleased"); }, 1300);
    }
    function scheduleBlink(eye) {
      if (eye.getAttribute("data-blink") === "1") return;
      eye.setAttribute("data-blink", "1");
      function again() {
        var wait = 3000 + Math.random() * 3000;
        window.setTimeout(function () {
          if (!eye.isConnected) return;
          if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
          eye.classList.add("is-blinking");
          window.setTimeout(function () {
            eye.classList.remove("is-blinking");
            again();
          }, 140);
        }, wait);
      }
      again();
    }
    function watchBlinks(node) {
      if (!node || !node.querySelectorAll) return;
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      var eyes = node.querySelectorAll(".eye");
      for (var i = 0; i < eyes.length; i++) scheduleBlink(eyes[i]);
    }`;

const ADI_EXPRESSION_CSS = `.eye { animation: none; transition: transform 80ms ease-in; }
.eye.is-blinking { transform: scaleY(0.08); }
.smile-rest, .smile-big { transition: opacity 180ms ease; }
.smile-big { opacity: 0; }
.launcher:hover .smile-rest { opacity: 0; }
.launcher:hover .smile-big { opacity: 1; }
:host(.is-pleased) .smile-rest { opacity: 0; }
:host(.is-pleased) .smile-big { opacity: 1; }
@media (prefers-reduced-motion: reduce) {
  .eye { transition: none; }
  .eye.is-blinking { transform: none; }
  .smile-rest, .smile-big { transition: none; }
  .smile-big,
  .launcher:hover .smile-big,
  :host(.is-pleased) .smile-big { opacity: 0; }
  .smile-rest,
  .launcher:hover .smile-rest,
  :host(.is-pleased) .smile-rest { opacity: 1; }
}
`;

/** Escape a string for use inside a JavaScript regex literal. Slashes included. */
function jsRegExpSource(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replaceAll("/", "\\/");
}

function escapeText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(value: string): string {
  return escapeText(value).replace(/"/g, "&quot;");
}
