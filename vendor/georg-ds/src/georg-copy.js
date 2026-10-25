/*
 * georg design system · copy button
 *
 * For .g-button.g-copy (components.css): a click copies the button's data-copy text, or the value or
 * text of the element matched by data-copy-target, to the clipboard. On success the button gets
 * data-copied for 1.6 s (its idle part swaps for its done part), assistive technology hears the done
 * label, and data-copy-toast shows a toast too when georg-toast.js is loaded. On failure (no text, no
 * clipboard permission) it gets data-copy-failed and announces data-copy-error.
 *
 * Load once per page, after components.css:
 *   <script src="georg-copy.js" defer></script>
 * Fires "g-copy:done" (detail.text) or "g-copy:error" on the button. georgCopy.copy(button) copies in code.
 */
(() => {
  const RESULT_VISIBLE_MS = 1600;
  const DEFAULT_DONE_MESSAGE = "Copied";
  const DEFAULT_ERROR_MESSAGE = "Could not copy";
  const resetTimers = new WeakMap();
  let announcer = null;

  // A polite live region of our own: a changing button label is not reliably announced. Recreated when the
  // page replaced it (a framework re-rendering <body>), since a detached region is never heard.
  function announce(message) {
    if (!announcer?.isConnected) {
      announcer = document.createElement("span");
      announcer.className = "g-visually-hidden";
      announcer.setAttribute("role", "status");
      announcer.setAttribute("aria-live", "polite");
      document.body.append(announcer);
    }
    announcer.textContent = message;
  }

  function targetText(selector) {
    let target = null;
    try {
      target = document.querySelector(selector);
    } catch {
      return null;
    }
    if (!target) return null;
    return typeof target.value === "string" ? target.value : target.textContent.trim();
  }

  function textToCopy(button) {
    if (button.hasAttribute("data-copy")) return button.dataset.copy;
    if (button.dataset.copyTarget) return targetText(button.dataset.copyTarget);
    return null;
  }

  // aria-hidden must be "true": an empty aria-hidden="" (what toggleAttribute writes) hides nothing.
  function setHidden(part, isHidden) {
    if (isHidden) part.setAttribute("aria-hidden", "true");
    else part.removeAttribute("aria-hidden");
  }

  /** Keeps the accessible name in step with what is visible: "Copy", then "Copied". */
  function showDoneLabel(button, isDone) {
    button.querySelectorAll(".g-copy-idle").forEach((part) => setHidden(part, isDone));
    button.querySelectorAll(".g-copy-done").forEach((part) => setHidden(part, !isDone));
  }

  function doneMessage(button) {
    const label = [...button.querySelectorAll(".g-copy-done")].find((part) => !part.closest(".g-copy-swap[aria-hidden]"));
    return label?.textContent.trim() || DEFAULT_DONE_MESSAGE;
  }

  function reset(button) {
    button.removeAttribute("data-copied");
    button.removeAttribute("data-copy-failed");
    showDoneLabel(button, false);
  }

  function scheduleReset(button) {
    clearTimeout(resetTimers.get(button));
    resetTimers.set(button, setTimeout(() => reset(button), RESULT_VISIBLE_MS));
  }

  function succeed(button, text) {
    reset(button);
    button.setAttribute("data-copied", "");
    showDoneLabel(button, true);
    const toastMessage = button.dataset.copyToast;
    if (toastMessage && window.georgToast) window.georgToast.show(toastMessage, { key: "copy", variant: "success" });
    else announce(toastMessage || doneMessage(button));
    button.dispatchEvent(new CustomEvent("g-copy:done", { bubbles: true, detail: { text } }));
    scheduleReset(button);
  }

  function fail(button) {
    reset(button);
    button.setAttribute("data-copy-failed", "");
    announce(button.dataset.copyError || DEFAULT_ERROR_MESSAGE);
    button.dispatchEvent(new CustomEvent("g-copy:error", { bubbles: true }));
    scheduleReset(button);
  }

  async function copy(button) {
    const text = textToCopy(button);
    if (text === null) return fail(button);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      return fail(button);
    }
    return succeed(button, text);
  }

  document.addEventListener("click", (event) => {
    const button = event.target instanceof Element ? event.target.closest(".g-copy") : null;
    if (button && !button.disabled) copy(button);
  });

  window.georgCopy = { copy };
})();
