// ⌘K: go anywhere, run any action, find what the edition offers by typing (georg-ds palette).

import { SPRING } from "@shipibo-studio/georg-ds/georg-motion.mjs";
import {
  IconCircleFilled,
  IconDeviceDesktop,
  IconFileImport,
  type IconFolder,
  IconMoon,
  IconPencilPlus,
  IconRefresh,
  IconSearch,
  IconSettings,
  IconSun,
} from "@tabler/icons-react";
import { AnimatePresence, motion } from "motion/react";
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { useWorkspacePaletteItems, WORKSPACE_DESTINATIONS } from "../editions/workspace";
import { useI18n } from "../i18n/I18nProvider";
import type { MessageKey } from "../i18n/translate";
import { MAX_QUERY_LENGTH, type Route } from "../lib/route";
import { type AccentName, georgTheme, type ThemePref } from "../lib/theme";
import { ACCOUNT_ITEMS, MAIL_ITEMS, type NavItem } from "./nav-items";
import type { PaletteItem } from "./palette-item";
import { useRefresh } from "./RefreshButton";

interface CommandPaletteProps {
  open: boolean;
  onClose(): void;
  navigate(route: Route): void;
  onCompose(): void;
  onSettings(): void;
  onImport(): void;
}

const MAX_RESULTS_PER_GROUP = 8;
const icon = (Icon: typeof IconFolder) => <Icon size={16} stroke={1.5} />;

function useItems(props: CommandPaletteProps): PaletteItem[] {
  const { t } = useI18n();
  const { open, navigate, onCompose, onSettings, onImport } = props;
  const workspace = useWorkspacePaletteItems(open, navigate);
  const { refresh } = useRefresh();

  return useMemo(() => {
    const destination = (item: NavItem): PaletteItem => ({
      id: `go-${item.id}`,
      group: "palette.group.navigation",
      label: t(item.label),
      icon: icon(item.Icon),
      run: () => navigate(item.route),
    });
    const themes: [ThemePref, MessageKey, typeof IconSun][] = [
      ["system", "appearance.system", IconDeviceDesktop],
      ["light", "appearance.light", IconSun],
      ["dark", "appearance.dark", IconMoon],
    ];
    const accents = Object.entries(georgTheme().ACCENTS) as [AccentName, { name: string; swatch: string }][];
    return [
      ...[...MAIL_ITEMS, ...WORKSPACE_DESTINATIONS, ...ACCOUNT_ITEMS].map(destination),
      {
        id: "refresh",
        group: "palette.group.actions",
        label: t("nav.refresh"),
        icon: icon(IconRefresh),
        run: () => void refresh(),
      },
      {
        id: "compose",
        group: "palette.group.actions",
        label: t("nav.compose"),
        icon: icon(IconPencilPlus),
        hint: "C",
        run: onCompose,
      },
      ...workspace.actions,
      {
        id: "settings",
        group: "palette.group.actions",
        label: t("nav.settings"),
        icon: icon(IconSettings),
        run: onSettings,
      },
      {
        id: "import",
        group: "palette.group.actions",
        label: t("import.title"),
        icon: icon(IconFileImport),
        run: onImport,
      },
      ...workspace.found,
      ...themes.map(([pref, label, Icon]) => ({
        id: `theme-${pref}`,
        group: "palette.group.appearance" as MessageKey,
        label: `${t("appearance.theme")}: ${t(label)}`,
        icon: icon(Icon),
        run: () => georgTheme().setTheme(pref),
      })),
      ...accents.map(([key, { name }]) => ({
        id: `accent-${key}`,
        group: "palette.group.appearance" as MessageKey,
        label: t("appearance.accentName", { name }),
        icon: <IconCircleFilled size={14} style={{ color: `var(--accent-${key})` }} />,
        run: () => georgTheme().setAccent(key),
      })),
    ];
  }, [navigate, onCompose, onImport, onSettings, refresh, t, workspace]);
}

/** Every word typed must appear somewhere in the label or its hint. */
function matches(item: PaletteItem, query: string): boolean {
  const haystack = `${item.label} ${item.hint ?? ""}`.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}

export function CommandPalette(props: CommandPaletteProps) {
  const { open, onClose } = props;
  const { t } = useI18n();
  const items = useItems(props);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { navigate } = props;
  const results = useMemo(() => {
    const filtered = items.filter((item) => matches(item, query));
    const perGroup = new Map<string, number>();
    const limited = filtered.filter((item) => {
      const count = (perGroup.get(item.group) ?? 0) + 1;
      perGroup.set(item.group, count);
      return count <= MAX_RESULTS_PER_GROUP;
    });
    const terms = query.trim().slice(0, MAX_QUERY_LENGTH);
    if (!terms) return limited;
    // Whatever was typed can also be searched for in the mail, last so Enter still runs the best match.
    const searchMail: PaletteItem = {
      id: "search-mail",
      group: "palette.group.search",
      label: t("palette.searchMail", { query: terms }),
      icon: icon(IconSearch),
      run: () => navigate({ section: "mail", folder: "inbox", messageId: null, query: terms }),
    };
    return [...limited, searchMail];
  }, [items, navigate, query, t]);

  // Reopening while the last close is still animating reuses the same dialog: start it fresh and
  // give it the focus explicitly (autoFocus only runs on mount).
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setSelected(0);
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open]);
  useEffect(() => setSelected((current) => Math.min(current, Math.max(0, results.length - 1))), [results.length]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${selected}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  // Cleared when closing, not only when opening: a close and a quick reopen can reach React in one
  // batch, and the next search must never start with the last one's text.
  const close = () => {
    setQuery("");
    setSelected(0);
    onClose();
  };
  const run = (item: PaletteItem | undefined) => {
    if (!item) return;
    close();
    item.run();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "ArrowDown") setSelected((index) => Math.min(index + 1, results.length - 1));
    else if (event.key === "ArrowUp") setSelected((index) => Math.max(index - 1, 0));
    else if (event.key === "Enter") run(results[selected]);
    else if (event.key === "Escape") close();
    else return;
    event.preventDefault();
  };

  let previousGroup = "";
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="overlay palette-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.12 } }}
          onMouseDown={(event) => event.target === event.currentTarget && close()}
        >
          <motion.div
            className="palette"
            role="dialog"
            aria-modal="true"
            aria-label={t("palette.label")}
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={SPRING.overlay}
          >
            <div className="palette-search">
              <IconSearch size={16} stroke={1.5} />
              <input
                ref={inputRef}
                // biome-ignore lint/a11y/noAutofocus: the palette opens to type
                autoFocus
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setSelected(0);
                }}
                onKeyDown={onKeyDown}
                placeholder={t("palette.placeholder")}
                aria-label={t("palette.placeholder")}
                aria-activedescendant={results[selected] ? `palette-${results[selected].id}` : undefined}
                aria-controls="palette-results"
                role="combobox"
                aria-expanded="true"
                spellCheck={false}
              />
              <kbd className="g-kbd">Esc</kbd>
            </div>
            <div className="palette-list" id="palette-results" role="listbox" ref={listRef}>
              {results.length === 0 && <div className="palette-empty">{t("palette.empty")}</div>}
              {results.map((item, index) => {
                const heading = item.group !== previousGroup ? t(item.group) : null;
                previousGroup = item.group;
                return (
                  <div key={item.id}>
                    {heading && <div className="palette-group">{heading}</div>}
                    <button
                      type="button"
                      id={`palette-${item.id}`}
                      role="option"
                      aria-selected={index === selected}
                      data-index={index}
                      className={`palette-item ${index === selected ? "selected" : ""}`}
                      onMouseMove={() => setSelected(index)}
                      onClick={() => run(item)}
                    >
                      {index === selected && (
                        <motion.span
                          layoutId="palette-selection"
                          className="palette-highlight"
                          transition={SPRING.list}
                        />
                      )}
                      {item.icon}
                      <span className={item.mono ? "mono" : undefined}>{item.label}</span>
                      {item.hint && <kbd className="g-kbd">{item.hint}</kbd>}
                    </button>
                  </div>
                );
              })}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
