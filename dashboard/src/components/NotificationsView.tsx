// The account's notification channels, in one place: the registered email (which also gets the
// forwarded copy of incoming mail), plus what the edition adds (Slack, in the hosted product).

import { EASE_OUT } from "@shipibo-studio/georg-ds/georg-motion.mjs";
import { IconAlertTriangle, IconMail, IconMailForward } from "@tabler/icons-react";
import { AnimatePresence, motion } from "motion/react";
import { useMailbox, useUpdateSettings } from "../api/queries";
import type { Mailbox } from "../api/types";
import { NotificationChannelsExtra } from "../editions/workspace";
import { useI18n } from "../i18n/I18nProvider";
import { formatBytes } from "../lib/format";
import { Switch } from "./controls";
import { useToast } from "./Toasts";

/** The forwarded copy of every incoming email, to the registered address. */
function ForwardSetting({ mailbox }: { mailbox: Mailbox }) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const update = useUpdateSettings();
  const change = (forwardEnabled: boolean) =>
    update.mutate(
      { forwardEnabled },
      {
        onSuccess: () => toast(t("settings.saved"), { key: "settings" }),
        onError: () => toast(t("error.generic"), { kind: "error" }),
      },
    );
  return (
    <div className={`setting ${mailbox.forwardTo ? "" : "disabled"}`}>
      <span className="setting-icon">
        <IconMailForward size={18} stroke={1.5} />
      </span>
      <div className="setting-text">
        <label htmlFor="forward-switch">{t("settings.forward")}</label>
        <p>
          {mailbox.forwardTo
            ? t("settings.forwardDescription", { address: mailbox.forwardTo })
            : t("settings.forwardMissing")}
        </p>
        <AnimatePresence initial={false}>
          {mailbox.forwardTo && !mailbox.forwardEnabled && (
            <motion.p
              className="setting-warning"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.22 }}
            >
              <IconAlertTriangle size={14} stroke={1.5} />
              {t("settings.forwardOffWarning", { size: formatBytes(mailbox.maxMessageBytes, locale) })}
            </motion.p>
          )}
        </AnimatePresence>
      </div>
      <Switch
        id="forward-switch"
        label={t("settings.forward")}
        checked={mailbox.forwardEnabled}
        disabled={!mailbox.forwardTo}
        onChange={change}
      />
    </div>
  );
}

export function NotificationsView() {
  const { t } = useI18n();
  const mailbox = useMailbox();
  return (
    <section className="list wide mcp-page" aria-label={t("notifications.title")}>
      <div className="list-head">
        <div className="list-title">
          <h2 className="folder-title">{t("notifications.title")}</h2>
        </div>
        <p className="muted small">{t("notifications.intro")}</p>
      </div>
      <motion.div
        className="mcp-body"
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28, ease: EASE_OUT }}
      >
        <div className="card mcp-step">
          <h3>
            <IconMail size={16} stroke={1.5} /> {t("notify.channel.email")}
          </h3>
          <p className="muted small">{t("notifications.emailHint")}</p>
          <p className="registered-email">{mailbox.data?.owner ?? "…"}</p>
          {mailbox.data && <ForwardSetting mailbox={mailbox.data} />}
        </div>
        <NotificationChannelsExtra />
      </motion.div>
    </section>
  );
}
