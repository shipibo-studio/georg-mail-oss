import { IconCheck, IconPencilPlus, IconSearch, IconSettings } from "@tabler/icons-react";
import { MorphIcon } from "morphicons/react";
import { motion } from "motion/react";
import type { Mailbox } from "../api/types";
import { WORKSPACE_DESTINATIONS } from "../editions/workspace";
import { useI18n } from "../i18n/I18nProvider";
import type { MessageKey } from "../i18n/translate";
import type { Route } from "../lib/route";
import { type AccentName, georgTheme, type ThemePref, useGeorgTheme } from "../lib/theme";
import { CountBadge, OwnerAvatar } from "./controls";
import { DESKTOP_ICON, MOON_ICON, SUN_ICON } from "./morph-icons";
import { ACCOUNT_ITEMS, MAIL_ITEMS, type NavItem } from "./nav-items";
import { useToast } from "./Toasts";
import { Tip } from "./Tooltip";

const THEME_OPTIONS: { pref: ThemePref; label: MessageKey }[] = [
  { pref: "system", label: "appearance.system" },
  { pref: "light", label: "appearance.light" },
  { pref: "dark", label: "appearance.dark" },
];
const THEME_ICONS = { system: DESKTOP_ICON, light: SUN_ICON, dark: MOON_ICON } as const;
const SEGMENT_WIDTH = 26;

export function ThemeControl() {
  const { t } = useI18n();
  const toast = useToast();
  const { pref } = useGeorgTheme();
  const choose = (next: ThemePref, label: MessageKey) => {
    georgTheme().setTheme(next);
    toast(`${t("appearance.theme")}: ${t(label)}`, { kind: "info", key: "appearance" });
  };
  return (
    <div className="segmented" role="radiogroup" aria-label={t("appearance.theme")}>
      <motion.span
        className="thumb"
        animate={{ x: THEME_OPTIONS.findIndex((option) => option.pref === pref) * SEGMENT_WIDTH }}
        transition={{ type: "spring", stiffness: 520, damping: 34 }}
      />
      {THEME_OPTIONS.map((option) => (
        <Tip key={option.pref} label={t(option.label)}>
          {/* biome-ignore lint/a11y/useSemanticElements: georg-ds segmented control, a radiogroup of icon buttons */}
          <button
            type="button"
            role="radio"
            aria-checked={pref === option.pref}
            aria-label={t(option.label)}
            onClick={() => choose(option.pref, option.label)}
          >
            <MorphIcon icon={THEME_ICONS[option.pref]} size={14} strokeWidth={1.5} reducedMotion="user" />
          </button>
        </Tip>
      ))}
    </div>
  );
}

export function AccentControl() {
  const { t } = useI18n();
  const toast = useToast();
  const { accent } = useGeorgTheme();
  const accents = Object.entries(georgTheme().ACCENTS) as [AccentName, { name: string; swatch: string }][];
  return (
    <div className="swatches" role="radiogroup" aria-label={t("appearance.accent")}>
      {accents.map(([key, { name }]) => (
        <Tip key={key} label={name}>
          {/* biome-ignore lint/a11y/useSemanticElements: georg-ds color swatches, a radiogroup of buttons */}
          <button
            type="button"
            role="radio"
            className="swatch"
            aria-checked={accent === key}
            aria-label={t("appearance.accentName", { name })}
            style={{ ["--swatch-color" as string]: `var(--accent-${key})` }}
            onClick={() => {
              if (accent === key) return;
              georgTheme().setAccent(key);
              toast(t("appearance.accentName", { name }), { kind: "info", key: "appearance" });
            }}
          >
            <IconCheck size={10} stroke={3} />
          </button>
        </Tip>
      ))}
    </div>
  );
}

interface SidebarProps {
  mailbox: Mailbox | undefined;
  route: Route;
  navigate(route: Route): void;
  onCompose(): void;
  onSettings(): void;
  onSearch(): void;
}

function NavGroup({
  title,
  items,
  route,
  navigate,
  unread,
}: {
  title: string;
  items: NavItem[];
  route: Route;
  navigate(route: Route): void;
  unread: number;
}) {
  const { t } = useI18n();
  return (
    <>
      <div className="section-title">{title}</div>
      <nav className="folders" aria-label={title}>
        {items.map((item) => {
          const active = item.active(route);
          return (
            <button
              key={item.id}
              type="button"
              className={`folder ${active ? "active" : ""}`}
              aria-current={active ? "page" : undefined}
              onClick={() => navigate(item.route)}
            >
              {active && (
                // One highlight for the whole sidebar: it slides between groups too.
                <motion.span
                  layoutId="folder-highlight"
                  className="folder-highlight"
                  transition={{ type: "spring", stiffness: 500, damping: 38 }}
                />
              )}
              <item.Icon size={16} stroke={1.5} />
              <span className="folder-name">{t(item.label)}</span>
              {item.id === "inbox" && <CountBadge count={unread} />}
            </button>
          );
        })}
      </nav>
    </>
  );
}

export function Sidebar({ mailbox, route, navigate, onCompose, onSettings, onSearch }: SidebarProps) {
  const { t } = useI18n();
  const unread = mailbox?.unread ?? 0;
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="logo">g</div>
        <div className="brand-name">
          georg <span>mail</span>
        </div>
      </div>

      <button type="button" className="search-trigger" onClick={onSearch}>
        <IconSearch size={16} stroke={1.5} />
        <span className="search-label">{t("nav.search")}</span>
        <span className="kbd">⌘K</span>
      </button>

      <div className="compose-row">
        <motion.button type="button" className="btn primary compose" onClick={onCompose} whileTap={{ scale: 0.97 }}>
          <IconPencilPlus size={16} stroke={1.5} />
          {t("nav.compose")}
          <span className="kbd kbd-on-primary">C</span>
        </motion.button>
      </div>

      <NavGroup title={t("nav.mail")} items={MAIL_ITEMS} route={route} navigate={navigate} unread={unread} />
      {WORKSPACE_DESTINATIONS.length > 0 && (
        <NavGroup
          title={t("nav.workspace")}
          items={WORKSPACE_DESTINATIONS}
          route={route}
          navigate={navigate}
          unread={0}
        />
      )}
      <NavGroup title={t("nav.account")} items={ACCOUNT_ITEMS} route={route} navigate={navigate} unread={0} />

      <div className="side-spacer" />

      <div className="side-foot">
        <div className="me">
          <OwnerAvatar size={30} />
          <Tip label={mailbox ? t("nav.signedInAs", { email: mailbox.owner }) : "…"}>
            <div className="who">
              {mailbox?.displayName ?? "Georg"}
              <small className="mono">{mailbox?.address ?? "…"}</small>
            </div>
          </Tip>
          <Tip label={t("nav.settings")}>
            <motion.button
              type="button"
              className="btn ghost icon settings-button"
              aria-label={t("nav.settings")}
              onClick={onSettings}
              whileHover={{ rotate: 45 }}
              transition={{ type: "spring", stiffness: 300, damping: 18 }}
            >
              <IconSettings size={16} stroke={1.5} />
            </motion.button>
          </Tip>
        </div>
      </div>
    </aside>
  );
}
