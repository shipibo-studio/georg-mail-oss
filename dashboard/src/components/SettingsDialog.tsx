// Settings in two tabs: Appearance, which people change now and then, and Mailbox, set up once
// (addresses, importing old mail, signing out), so the dialog stays short. The version and updates
// live at the foot of the sidebar.
import { EASE_OUT, GESTURE, SPRING } from "@shipibo-studio/georg-ds/georg-motion.mjs";
import { IconFileImport, IconLogout, IconX } from "@tabler/icons-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import type { Mailbox } from "../api/types";
import { useI18n } from "../i18n/I18nProvider";
import { LOCALE_NAMES, LOCALES, type Locale } from "../i18n/translate";
import { AVATAR_STYLES, type AvatarStyle, setAvatarStyle, useAvatarStyle } from "../lib/avatar-style";
import { CLOCKS, type Clock, sampleTime } from "../lib/format";
import { isSwipeDown, useIsPhone } from "../lib/media";
import { play, setSounds, useSounds } from "../lib/sounds";
import { AliasSettings } from "./AliasSettings";
import { HoldButton, Switch, TabBar } from "./controls";
import { AccentControl, ThemeControl } from "./Sidebar";

const ACCESS_LOGOUT_PATH = "/cdn-cgi/access/logout";

export type SettingsTab = "appearance" | "mailbox";

/**
 * Sign out by press and hold, the app's way to confirm an action with one outcome: a click alone
 * does nothing. It ends the Access session, so the next visit signs in again.
 */
function SignOut() {
  const { t } = useI18n();
  return (
    <HoldButton
      label={t("settings.holdToSignOut")}
      className="g-button g-button-ghost sign-out"
      // Cloudflare Access ends the session on this path of any protected app.
      onConfirm={() => window.location.assign(ACCESS_LOGOUT_PATH)}
    >
      <IconLogout size={16} stroke={1.5} /> {t("settings.signOut")}
    </HoldButton>
  );
}

function AppearanceSettings() {
  const { t, locale, setLocale, clock, setClock } = useI18n();
  const avatarStyle = useAvatarStyle();
  const sounds = useSounds();
  return (
    <section className="settings-section">
      <div className="setting compact">
        <span className="setting-text">{t("appearance.theme")}</span>
        <ThemeControl />
      </div>
      <div className="setting compact">
        <span className="setting-text">{t("appearance.accent")}</span>
        <AccentControl />
      </div>
      <div className="setting compact">
        <label className="setting-text" htmlFor="language-select">
          {t("appearance.language")}
        </label>
        <select
          id="language-select"
          className="g-input select"
          value={locale}
          onChange={(event) => setLocale(event.target.value as Locale)}
        >
          {LOCALES.map((option) => (
            <option key={option} value={option}>
              {LOCALE_NAMES[option]}
            </option>
          ))}
        </select>
      </div>
      <div className="setting compact">
        <label className="setting-text" htmlFor="avatar-select">
          {t("appearance.avatars")}
        </label>
        <select
          id="avatar-select"
          className="g-input select"
          value={avatarStyle}
          onChange={(event) => setAvatarStyle(event.target.value as AvatarStyle)}
        >
          {AVATAR_STYLES.map((option) => (
            <option key={option} value={option}>
              {t(option === "faces" ? "appearance.avatarFaces" : "appearance.avatarInitials")}
            </option>
          ))}
        </select>
      </div>
      <div className="setting compact">
        <label className="setting-text" htmlFor="clock-select">
          {t("appearance.clock")}
        </label>
        <select
          id="clock-select"
          className="g-input select"
          value={clock}
          onChange={(event) => setClock(event.target.value as Clock)}
        >
          {CLOCKS.map((option) => (
            <option key={option} value={option}>
              {t(option === "24h" ? "appearance.clock24" : "appearance.clock12", {
                sample: sampleTime(locale, option),
              })}
            </option>
          ))}
        </select>
      </div>
      <div className="setting compact">
        <label className="setting-text" htmlFor="sounds-switch">
          {t("appearance.sounds")}
        </label>
        <Switch
          id="sounds-switch"
          label={t("appearance.sounds")}
          checked={sounds === "on"}
          onChange={(on) => {
            setSounds(on ? "on" : "off");
            // A sample of what was just switched on.
            if (on) play("toggleOn");
          }}
        />
      </div>
    </section>
  );
}

function MailboxSettings({ mailbox, onImport }: { mailbox: Mailbox; onImport(): void }) {
  const { t } = useI18n();
  return (
    <>
      <section className="settings-section">
        <div className="label">{t("aliases.section")}</div>
        <p className="muted small">{t("aliases.description")}</p>
        <AliasSettings mailbox={mailbox} />
      </section>
      <section className="settings-section">
        <div className="label">{t("import.section")}</div>
        <div className="setting compact">
          <span className="setting-text">{t("import.description")}</span>
          <button type="button" className="g-button" onClick={onImport}>
            <IconFileImport size={16} stroke={1.5} />
            {t("import.open")}
          </button>
        </div>
      </section>
      <div className="signed-in">
        <span className="muted small">
          {t("settings.signedInAs")} <span className="registered-email">{mailbox.owner}</span>
        </span>
        <SignOut />
      </div>
    </>
  );
}

export function SettingsDialog({
  mailbox,
  initialTab = "appearance",
  onClose,
  onImport,
}: {
  mailbox: Mailbox;
  initialTab?: SettingsTab;
  onClose(): void;
  onImport(): void;
}) {
  const { t } = useI18n();
  const [tab, setTab] = useState<SettingsTab>(initialTab);
  const panel = useRef<HTMLDivElement>(null);
  const isPhone = useIsPhone();

  useEffect(() => {
    panel.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <motion.div
      className="overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.16 } }}
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <motion.div
        ref={panel}
        tabIndex={-1}
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        // A bottom sheet on phones, a centered dialog elsewhere.
        initial={isPhone ? { y: "100%" } : { opacity: 0, y: -8, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={isPhone ? { y: "100%" } : { opacity: 0, y: -4, scale: 0.98 }}
        transition={SPRING.sheet}
        // On phones the sheet follows the finger down and closes past a threshold.
        drag={isPhone ? "y" : false}
        dragDirectionLock
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0, bottom: GESTURE.sheetElastic }}
        dragSnapToOrigin
        onDragEnd={(_, info) => {
          if (isSwipeDown(info.offset.y, info.velocity.y)) onClose();
        }}
      >
        <span className="sheet-grabber" aria-hidden="true" />
        <header className="dialog-head">
          <h2 id="settings-title">{t("settings.title")}</h2>
          <button
            type="button"
            className="g-button g-button-ghost g-button-icon"
            aria-label={t("settings.close")}
            onClick={onClose}
          >
            <IconX size={16} stroke={1.5} />
          </button>
        </header>

        <TabBar<SettingsTab>
          id="settings-tabs"
          value={tab}
          onChange={setTab}
          tabs={[
            { value: "appearance", label: t("settings.appearance") },
            { value: "mailbox", label: t("settings.mailbox") },
          ]}
        />
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={tab}
            className="settings-tab"
            role="tabpanel"
            aria-label={t(tab === "appearance" ? "settings.appearance" : "settings.mailbox")}
            initial={{ opacity: 0, y: 3 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, transition: { duration: 0.1 } }}
            transition={{ duration: 0.24, ease: EASE_OUT }}
          >
            {tab === "appearance" ? <AppearanceSettings /> : <MailboxSettings mailbox={mailbox} onImport={onImport} />}
          </motion.div>
        </AnimatePresence>
      </motion.div>
    </motion.div>
  );
}
