// First run of a self-hosted mail client: the person Cloudflare Access let in picks the mailbox
// address, a display name and whether to get a copy of new mail, and becomes its owner. Shown only
// when the mailbox cannot load because nobody owns the install yet; the Worker decides that.
import { IconAlertTriangle, IconMailForward } from "@tabler/icons-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import { type FormEvent, type ReactNode, useState } from "react";
import { ApiError, setupApi } from "../api/client";
import { useI18n } from "../i18n/I18nProvider";
import { Switch } from "./controls";

const MAX_DISPLAY_NAME_LENGTH = 100;

function SetupForm({
  email,
  addresses,
  canForward,
  onDone,
}: {
  email: string;
  addresses: string[];
  canForward: boolean;
  onDone(): void;
}) {
  const { t } = useI18n();
  const [address, setAddress] = useState(addresses[0] ?? "");
  const [displayName, setDisplayName] = useState("");
  const [forward, setForward] = useState(true);
  const complete = useMutation({ mutationFn: setupApi.complete, onSuccess: onDone });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    complete.mutate({ address, displayName: displayName.trim() || undefined, forward: canForward && forward });
  };
  const taken = complete.error instanceof ApiError && complete.error.status === 409;

  if (addresses.length === 0) return <p className="setup-note">{t("setup.noAddresses")}</p>;
  return (
    <form className="setup-form" onSubmit={submit}>
      {addresses.length === 1 ? (
        <div className="form-field">
          <span id="setup-address-label">{t("setup.address")}</span>
          <output className="setup-address mono" aria-labelledby="setup-address-label">
            {address}
          </output>
        </div>
      ) : (
        <label className="form-field">
          <span>{t("setup.address")}</span>
          <select className="select" value={address} onChange={(event) => setAddress(event.target.value)}>
            {addresses.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="form-field">
        <span>{t("setup.displayName")}</span>
        <input
          // biome-ignore lint/a11y/noAutofocus: the only thing to type on this page
          autoFocus
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          placeholder={t("setup.displayNamePlaceholder")}
          maxLength={MAX_DISPLAY_NAME_LENGTH}
        />
        <small>{t("setup.displayNameHint")}</small>
      </label>
      <div className="setting compact">
        <span className="setting-icon">
          <IconMailForward size={18} stroke={1.5} />
        </span>
        <div className="setting-text">
          {canForward ? (
            <>
              <label htmlFor="setup-forward">{t("settings.forward")}</label>
              <p>{t("settings.forwardDescription", { address: email })}</p>
            </>
          ) : (
            <>
              <span className="setting-label">{t("settings.forward")}</span>
              <p>{t("setup.noForward", { email })}</p>
            </>
          )}
        </div>
        {canForward && (
          <Switch id="setup-forward" label={t("settings.forward")} checked={forward} onChange={setForward} />
        )}
      </div>
      {complete.isError && (
        <p className="setup-error" role="alert">
          <IconAlertTriangle size={14} stroke={1.5} />
          {taken ? t("setup.taken") : t("error.generic")}
        </p>
      )}
      <button type="submit" className="btn primary" disabled={complete.isPending || !address}>
        {complete.isPending ? t("setup.creating") : t("setup.create")}
      </button>
    </form>
  );
}

/**
 * Asks the Worker whether this install still needs its owner. Anything else (the hosted product,
 * which has no first run, or an install already set up) shows `fallback`.
 */
export function SetupGate({ fallback, onDone }: { fallback: ReactNode; onDone(): void }) {
  const { t } = useI18n();
  const status = useQuery({ queryKey: ["setup"], queryFn: setupApi.status, retry: false });
  if (status.isPending) return null;
  if (!status.data?.needed) return fallback;
  return (
    <main className="setup">
      <motion.section
        className="setup-card"
        aria-labelledby="setup-title"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="brand">
          <div className="logo">g</div>
          <div className="brand-name">
            georg <span>mail</span>
          </div>
        </div>
        <h1 id="setup-title">{t("setup.title")}</h1>
        <p className="muted">{t("setup.intro", { email: status.data.email })}</p>
        <SetupForm
          email={status.data.email}
          addresses={status.data.addresses}
          canForward={status.data.canForward}
          onDone={onDone}
        />
      </motion.section>
    </main>
  );
}
