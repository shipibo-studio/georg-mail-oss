import { IconFileImport, IconLogout, IconX } from "@tabler/icons-react";
import { motion } from "motion/react";
import { useEffect, useRef } from "react";
import type { Mailbox } from "../api/types";
import { useI18n } from "../i18n/I18nProvider";
import { LOCALE_NAMES, LOCALES, type Locale } from "../i18n/translate";
import { AVATAR_STYLES, type AvatarStyle, setAvatarStyle, useAvatarStyle } from "../lib/avatar-style";
import { CLOCKS, type Clock, sampleTime } from "../lib/format";
import { isSwipeDown, useIsPhone } from "../lib/media";
import { play, setSounds, useSounds } from "../lib/sounds";
import { AliasSettings } from "./AliasSettings";
import { Switch } from "./controls";
import { AccentControl, ThemeControl } from "./Sidebar";
import { UpdateSettings } from "./UpdateDialog";

const ACCESS_LOGOUT_PATH = "/cdn-cgi/access/logout";

export function SettingsDialog({
  mailbox,
  onClose,
  onImport,
  onUpdate,
}: {
  mailbox: Mailbox;
  onClose(): void;
  onImport(): void;
  onUpdate(): void;
}) {
  const { t, locale, setLocale, clock, setClock } = useI18n();
  const avatarStyle = useAvatarStyle();
  const sounds = useSounds();
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
        transition={{ type: "spring", stiffness: 420, damping: 32 }}
        // On phones the sheet follows the finger down and closes past a threshold.
        drag={isPhone ? "y" : false}
        dragDirectionLock
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0, bottom: 0.7 }}
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

        <section className="settings-section">
          <div className="label">
            {t("settings.appearance")} <span className="scope">{t("settings.scopeEverywhere")}</span>
          </div>
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
        <section className="settings-section">
          <div className="label">
            {t("aliases.section")} <span className="scope">{t("settings.scopeMail")}</span>
          </div>
          <p className="muted small">{t("aliases.description")}</p>
          <AliasSettings mailbox={mailbox} />
        </section>
        <section className="settings-section">
          <div className="label">
            {t("import.section")} <span className="scope">{t("settings.scopeMail")}</span>
          </div>
          <div className="setting compact">
            <span className="setting-text">{t("import.description")}</span>
            <button type="button" className="g-button" onClick={onImport}>
              <IconFileImport size={16} stroke={1.5} />
              {t("import.open")}
            </button>
          </div>
        </section>
        <UpdateSettings onUpdate={onUpdate} />
        <div className="signed-in">
          <span className="muted small">
            {t("settings.signedInAs")} <span className="registered-email">{mailbox.owner}</span>
          </span>
          {/* Cloudflare Access ends the session on this path of any protected app. */}
          <a className="g-button g-button-ghost sign-out" href={ACCESS_LOGOUT_PATH}>
            <IconLogout size={16} stroke={1.5} /> {t("settings.signOut")}
          </a>
        </div>
      </motion.div>
    </motion.div>
  );
}
