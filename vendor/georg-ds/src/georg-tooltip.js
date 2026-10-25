/*
 * georg design system · tooltip dismissal
 *
 * The plain-HTML tooltip (.g-tooltip-anchor > .g-tooltip in components.css) opens with CSS alone. This adds what
 * CSS cannot do: Escape hides a visible tooltip without moving the pointer or focus (WCAG 1.4.13). The
 * tooltip stays hidden until the pointer or focus leaves its anchor and comes back.
 *
 * Load it once per page, after components.css:
 *   <script src="georg-tooltip.js" defer></script>
 * Not needed with Radix/shadcn tooltips, which dismiss on Escape themselves.
 */
(() => {
  const ANCHOR_SELECTOR = ".g-tooltip-anchor";
  const OPEN_ANCHOR_SELECTOR = `${ANCHOR_SELECTOR}:hover, ${ANCHOR_SELECTOR}:has(:focus-visible)`;

  function openAnchors() {
    try {
      return document.querySelectorAll(OPEN_ANCHOR_SELECTOR);
    } catch {
      // Browsers without :has() cannot match keyboard focus; hovered anchors are still dismissible.
      return document.querySelectorAll(`${ANCHOR_SELECTOR}:hover`);
    }
  }

  function dismissOpenTooltips(event) {
    if (event.key !== "Escape") return;
    openAnchors().forEach((anchor) => {
      anchor.dataset.tooltipDismissed = "";
    });
  }

  // Entering an anchor from outside re-arms its tooltip; moving between its own children does not.
  function rearmOnEnter(event) {
    const anchor = event.target instanceof Element ? event.target.closest(ANCHOR_SELECTOR) : null;
    if (!anchor || anchor.contains(event.relatedTarget)) return;
    delete anchor.dataset.tooltipDismissed;
  }

  document.addEventListener("keydown", dismissOpenTooltips);
  document.addEventListener("pointerover", rearmOnEnter);
  document.addEventListener("focusin", rearmOnEnter);
})();
