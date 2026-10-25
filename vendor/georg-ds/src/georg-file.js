/*
 * georg design system · file drop zone
 *
 * For .g-file (components.css), whose native <input type="file"> already handles clicks and drops.
 * This adds what the input does not do:
 *   - data-dragging on the zone while files are dragged over it;
 *   - the accept filter for dropped files (the picker filters, a drop does not): rejected files are
 *     removed, the input gets aria-invalid and the element in data-file-error says which ones;
 *   - the list of chosen files in the element named by data-file-list, each chip with its name, size
 *     and a remove button.
 * Markup: <label class="g-file"><input type="file" data-file-list="#files" data-file-error="#files-error">…</label>
 *
 * Load once per page, after components.css:
 *   <script src="georg-file.js" defer></script>
 * Fires "g-file:change" (detail.files, detail.rejected) on the input. Not needed when a framework renders
 * the list itself; the CSS works on its own.
 */
(() => {
  const ZONE_SELECTOR = ".g-file";
  const INPUT_SELECTOR = '.g-file > input[type="file"], .g-file-button > input[type="file"]';
  const SIZE_UNITS = ["B", "KB", "MB", "GB"];
  const BYTES_PER_UNIT = 1024;

  /** 1536 → "1.5 KB": one decimal below 10, none above, like Finder. */
  function formatSize(bytes) {
    let size = bytes;
    let unit = 0;
    while (size >= BYTES_PER_UNIT && unit < SIZE_UNITS.length - 1) {
      size /= BYTES_PER_UNIT;
      unit += 1;
    }
    const digits = unit === 0 || size >= 10 ? 0 : 1;
    return `${size.toFixed(digits)} ${SIZE_UNITS[unit]}`;
  }

  /** Mirrors the accept attribute: extensions (.zip), exact types (text/plain) and wildcards (image/*). */
  function isAccepted(file, accept) {
    const rules = accept.split(",").map((rule) => rule.trim().toLowerCase()).filter(Boolean);
    if (rules.length === 0) return true;
    const name = file.name.toLowerCase();
    const type = (file.type || "").toLowerCase();
    return rules.some((rule) => {
      if (rule.startsWith(".")) return name.endsWith(rule);
      if (rule.endsWith("/*")) return type.startsWith(rule.slice(0, -1));
      return type === rule;
    });
  }

  function findElement(selector) {
    if (!selector) return null;
    try {
      return document.querySelector(selector);
    } catch {
      return null;
    }
  }

  function replaceFiles(input, files) {
    const transfer = new DataTransfer();
    files.forEach((file) => transfer.items.add(file));
    input.files = transfer.files;
  }

  function fileChip(input, file, index) {
    const chip = document.createElement("li");
    chip.className = "g-file-chip";
    const name = document.createElement("span");
    name.className = "g-file-name";
    name.textContent = file.name;
    const size = document.createElement("span");
    size.className = "g-file-size";
    size.textContent = formatSize(file.size);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.setAttribute("aria-label", `Remove ${file.name}`);
    remove.textContent = "×";
    remove.addEventListener("click", () => {
      replaceFiles(input, [...input.files].filter((_, position) => position !== index));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    chip.append(name, size, remove);
    return chip;
  }

  function renderList(input) {
    const list = findElement(input.dataset.fileList);
    if (list) list.replaceChildren(...[...input.files].map((file, index) => fileChip(input, file, index)));
  }

  function reportRejected(input, rejected) {
    if (rejected.length > 0) input.setAttribute("aria-invalid", "true");
    else input.removeAttribute("aria-invalid");
    const error = findElement(input.dataset.fileError);
    if (error) error.textContent = rejected.length > 0 ? `Not accepted: ${rejected.map((file) => file.name).join(", ")}` : "";
  }

  function onChange(event) {
    const input = event.target instanceof Element ? event.target.closest(INPUT_SELECTOR) : null;
    if (!input || input !== event.target) return;
    const chosen = [...input.files];
    const accepted = chosen.filter((file) => isAccepted(file, input.accept));
    const rejected = chosen.filter((file) => !accepted.includes(file));
    if (rejected.length > 0) replaceFiles(input, accepted);
    reportRejected(input, rejected);
    renderList(input);
    input.dispatchEvent(new CustomEvent("g-file:change", { bubbles: true, detail: { files: accepted, rejected } }));
  }

  function zoneOf(event) {
    return event.target instanceof Element ? event.target.closest(ZONE_SELECTOR) : null;
  }

  function onDragEnter(event) {
    zoneOf(event)?.setAttribute("data-dragging", "");
  }

  function onDragLeave(event) {
    const zone = zoneOf(event);
    if (zone && !zone.contains(event.relatedTarget)) zone.removeAttribute("data-dragging");
  }

  function onDrop(event) {
    zoneOf(event)?.removeAttribute("data-dragging");
  }

  document.addEventListener("change", onChange);
  document.addEventListener("dragenter", onDragEnter);
  document.addEventListener("dragleave", onDragLeave);
  document.addEventListener("drop", onDrop);

  window.georgFile = { formatSize, isAccepted };
})();
