/*
 * georg design system · toasts
 *
 * georgToast.show(message, { variant, key, duration }) shows brief, non-critical feedback at the bottom
 * center, inside a polite live region (.g-toasts / .g-toast in components.css). A toast with the same key
 * replaces the previous one with a short bump instead of stacking. Messages are set as text, never HTML.
 * Anything that needs a decision is not a toast: use a dialog or an inline state.
 *
 * Load once per page, after components.css:
 *   <script src="georg-toast.js" defer></script>
 */
(() => {
  const VARIANTS = ["info", "success", "error"];
  const DEFAULT_DURATION_MS = 2400;
  const ERROR_DURATION_MS = 4000;
  const MAX_VISIBLE_TOASTS = 3;
  // Removes a leaving toast even when animationend never fires (reduced motion, a hidden tab).
  const LEAVE_FALLBACK_MS = 400;
  const dismissTimers = new WeakMap();

  function liveRegion() {
    let region = document.querySelector(".g-toasts");
    if (!region) {
      region = document.createElement("div");
      region.className = "g-toasts";
      region.setAttribute("role", "status");
      region.setAttribute("aria-live", "polite");
      document.body.append(region);
    }
    return region;
  }

  const isLeaving = (toast) => toast.hasAttribute("data-leaving");

  function dismiss(toast) {
    if (!toast.isConnected || isLeaving(toast)) return;
    clearTimeout(dismissTimers.get(toast));
    toast.setAttribute("data-leaving", "");
    const remove = () => toast.remove();
    toast.addEventListener("animationend", remove, { once: true });
    setTimeout(remove, LEAVE_FALLBACK_MS);
  }

  function scheduleDismiss(toast, durationMs) {
    clearTimeout(dismissTimers.get(toast));
    dismissTimers.set(toast, setTimeout(() => dismiss(toast), durationMs));
  }

  function validate(message, variant, duration) {
    if (typeof message !== "string" || message.trim() === "") throw new TypeError("georgToast.show needs a non-empty message");
    if (!VARIANTS.includes(variant)) throw new Error(`Unknown toast variant: ${variant}`);
    if (duration !== undefined && !(Number.isFinite(duration) && duration > 0)) throw new RangeError(`Invalid toast duration: ${duration}`);
  }

  function replaceableToast(region, key) {
    if (key === undefined) return null;
    return [...region.children].find((toast) => toast.dataset.key === String(key) && !isLeaving(toast)) ?? null;
  }

  function bump(toast) {
    toast.removeAttribute("data-bump");
    void toast.offsetWidth; // Restart the CSS animation.
    toast.setAttribute("data-bump", "");
  }

  function show(message, { variant = "info", key, duration } = {}) {
    validate(message, variant, duration);
    const region = liveRegion();
    let toast = replaceableToast(region, key);
    if (toast) {
      bump(toast);
    } else {
      toast = document.createElement("div");
      toast.className = "g-toast";
      if (key !== undefined) toast.dataset.key = String(key);
      region.append(toast);
    }
    toast.textContent = message;
    toast.dataset.variant = variant;
    scheduleDismiss(toast, duration ?? (variant === "error" ? ERROR_DURATION_MS : DEFAULT_DURATION_MS));

    // Keep the newest toasts; older ones leave first.
    const activeToasts = [...region.children].filter((candidate) => !isLeaving(candidate));
    activeToasts.slice(0, Math.max(0, activeToasts.length - MAX_VISIBLE_TOASTS)).forEach(dismiss);
    return () => dismiss(toast);
  }

  window.georgToast = { show };
})();
