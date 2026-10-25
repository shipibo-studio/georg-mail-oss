/*
 * georg design system · tabs behavior
 *
 * For the markup in docs/components.md: a role="tablist" (.g-tabs) of role="tab" buttons that point to
 * their panels with aria-controls. Adds the WAI-ARIA tabs keyboard model: Left and Right (Up and Down
 * when aria-orientation="vertical") move between tabs and wrap, Home and End jump to the ends, and the
 * selection follows focus. Only the selected tab is in the Tab order. Disabled tabs are skipped.
 *
 * Load once per page, after components.css:
 *   <script src="georg-tabs.js" defer></script>
 * Tabs added later: georgTabs.init(container). Changes fire "g-tabs:change" on the tablist.
 * Not needed with Radix Tabs, which implements the same model.
 */
(() => {
  const TABLIST_SELECTOR = '[role="tablist"]';
  const TAB_SELECTOR = '[role="tab"]';
  const STEP_KEYS = {
    horizontal: { ArrowRight: 1, ArrowLeft: -1 },
    vertical: { ArrowDown: 1, ArrowUp: -1 },
  };

  function tabsOf(tablist) {
    return [...tablist.querySelectorAll(TAB_SELECTOR)].filter((tab) => tab.closest(TABLIST_SELECTOR) === tablist);
  }

  const isEnabled = (tab) => !tab.disabled && tab.getAttribute("aria-disabled") !== "true";

  function panelOf(tab) {
    const panelId = tab.getAttribute("aria-controls");
    return panelId ? document.getElementById(panelId) : null;
  }

  function select(tab, { focus = false, notify = true } = {}) {
    const tablist = tab.closest(TABLIST_SELECTOR);
    if (!tablist || !isEnabled(tab)) return;
    for (const candidate of tabsOf(tablist)) {
      const isSelected = candidate === tab;
      candidate.setAttribute("aria-selected", String(isSelected));
      candidate.tabIndex = isSelected ? 0 : -1;
      const panel = panelOf(candidate);
      if (panel) panel.hidden = !isSelected;
    }
    if (focus) tab.focus();
    if (notify) tablist.dispatchEvent(new CustomEvent("g-tabs:change", { bubbles: true, detail: { tab } }));
  }

  /** Brings every tablist under root to a consistent state: one selected tab, its panel shown. */
  function init(root = document) {
    for (const tablist of root.querySelectorAll(TABLIST_SELECTOR)) {
      const enabledTabs = tabsOf(tablist).filter(isEnabled);
      const selected = enabledTabs.find((tab) => tab.getAttribute("aria-selected") === "true") ?? enabledTabs[0];
      if (selected) select(selected, { notify: false });
    }
  }

  function tabFromEvent(event) {
    const tab = event.target instanceof Element ? event.target.closest(TAB_SELECTOR) : null;
    return tab && tab.closest(TABLIST_SELECTOR) ? tab : null;
  }

  function onClick(event) {
    const tab = tabFromEvent(event);
    if (tab) select(tab);
  }

  function nextTab(tabs, current, key, orientation) {
    const steps = STEP_KEYS[orientation];
    if (Object.hasOwn(steps, key)) return tabs.at((tabs.indexOf(current) + steps[key]) % tabs.length);
    if (key === "Home") return tabs[0];
    if (key === "End") return tabs.at(-1);
    return null;
  }

  function onKeydown(event) {
    const tab = tabFromEvent(event);
    if (!tab) return;
    const tablist = tab.closest(TABLIST_SELECTOR);
    const orientation = tablist.getAttribute("aria-orientation") === "vertical" ? "vertical" : "horizontal";
    const enabledTabs = tabsOf(tablist).filter(isEnabled);
    const target = nextTab(enabledTabs, tab, event.key, orientation);
    if (!target) return;
    event.preventDefault();
    select(target, { focus: true });
  }

  document.addEventListener("click", onClick);
  document.addEventListener("keydown", onKeydown);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => init());
  else init();

  window.georgTabs = { init, select };
})();
