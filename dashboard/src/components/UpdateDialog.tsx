// In-app updates of the self-hosted mail client: a notice when a new release is out, its place in
// Settings, and the dialog that reviews the update, asks for confirmation, copies the release's files
// into the install's repository and makes the commit Cloudflare then deploys. The hosted product has
// none of it: its status query answers null and nothing renders.

import { SPRING } from "@shipibo-studio/georg-ds/georg-motion.mjs";
import { IconAlertTriangle, IconCircleCheck, IconExternalLink, IconRefresh, IconX } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { ApiError, updatesApi } from "../api/client";
import { keys, useUpdateStatus } from "../api/queries";
import type { UpdateCommit, UpdatePlan } from "../api/types";
import { useI18n } from "../i18n/I18nProvider";
import { play } from "../lib/sounds";

/** Where a hand update is explained (the open-source repository's guide). */
const MANUAL_UPDATE_URL = "https://github.com/shipibo-studio/georg-mail-oss/blob/main/docs/self-hosting.md#upgrading";
const LISTED_CONFLICTS = 5;

type Phase =
  | { name: "reviewing" }
  | { name: "confirm"; plan: UpdatePlan }
  | { name: "copying"; plan: UpdatePlan; done: number }
  | { name: "committing"; plan: UpdatePlan }
  | { name: "done"; plan: UpdatePlan; commit: UpdateCommit }
  | { name: "failed"; message: string };

function ExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a className="update-link" href={href} target="_blank" rel="noreferrer noopener">
      {children}
      <IconExternalLink size={13} stroke={1.5} aria-hidden="true" />
    </a>
  );
}

/** A line in the sidebar while a newer release is out. */
export function UpdateNotice({ onOpen }: { onOpen(): void }) {
  const { t } = useI18n();
  const status = useUpdateStatus().data;
  if (!status?.available || !status.latest) return null;
  return (
    <button type="button" className="update-notice" onClick={onOpen}>
      <IconRefresh size={14} stroke={1.5} aria-hidden="true" />
      {t("updates.notice", { version: status.latest.version })}
    </button>
  );
}

/** Settings → Updates: the installed version, and what to do when a newer one is out. */
export function UpdateSettings({ onUpdate }: { onUpdate(): void }) {
  const { t } = useI18n();
  const status = useUpdateStatus().data;
  if (!status) return null;
  const latest = status.latest;
  return (
    <section className="settings-section update-settings">
      <div className="label">{t("updates.section")}</div>
      <p className="small">
        {status.available && latest
          ? t("updates.available", { version: latest.version, installed: status.installed })
          : t("updates.current", { version: status.installed })}
      </p>
      {status.checkFailed && <p className="muted small">{t("updates.checkFailed")}</p>}
      {status.available && latest && (
        <div className="update-row">
          <ExternalLink href={latest.url}>{t("updates.notes")}</ExternalLink>
          {status.repository ? (
            <button type="button" className="g-button g-button-primary" onClick={onUpdate}>
              {t("updates.review")}
            </button>
          ) : (
            <ExternalLink href={MANUAL_UPDATE_URL}>{t("updates.manual")}</ExternalLink>
          )}
        </div>
      )}
      {status.available && !status.repository && <p className="muted small">{t("updates.manualHint")}</p>}
    </section>
  );
}

function PlanSummary({ plan }: { plan: UpdatePlan }) {
  const { t, plural } = useI18n();
  if (plan.configChanged) return <p className="update-blocked">{t("updates.configChanged")}</p>;
  if (plan.conflictCount > 0) {
    const more = plan.conflictCount - Math.min(plan.conflicts.length, LISTED_CONFLICTS);
    return (
      <div className="update-blocked">
        <p>{t("updates.conflicts")}</p>
        <ul className="update-conflicts">
          {plan.conflicts.slice(0, LISTED_CONFLICTS).map((path) => (
            <li key={path} className="mono small">
              {path}
            </li>
          ))}
          {more > 0 && <li className="muted small">{t("updates.conflictsMore", { count: more })}</li>}
        </ul>
      </div>
    );
  }
  if (!plan.canApply) return <p>{t("updates.nothing", { version: plan.to })}</p>;
  return (
    <>
      <p>
        {plural("updates.summary", plan.writes.length, { repository: plan.repository })}
        {plan.deletes > 0 && ` ${plural("updates.removed", plan.deletes)}`}
      </p>
      <p className="muted small">{t("updates.howItWorks")}</p>
    </>
  );
}

export function UpdateDialog({ version, onClose }: { version: string; onClose(): void }) {
  const { t } = useI18n();
  const client = useQueryClient();
  const [phase, setPhase] = useState<Phase>({ name: "reviewing" });
  const working = phase.name === "copying" || phase.name === "committing";
  const closed = useRef(false);

  async function review() {
    setPhase({ name: "reviewing" });
    try {
      const plan = await updatesApi.plan(version);
      if (!closed.current) setPhase({ name: "confirm", plan });
    } catch (error) {
      if (!closed.current) setPhase({ name: "failed", message: error instanceof ApiError ? error.message : "" });
    }
  }

  async function apply(plan: UpdatePlan) {
    try {
      for (let done = 0; done < plan.writes.length; done += plan.stageBatch) {
        setPhase({ name: "copying", plan, done });
        await updatesApi.stage(plan.to, plan.writes.slice(done, done + plan.stageBatch));
      }
      setPhase({ name: "committing", plan });
      const commit = await updatesApi.apply(plan.to, plan.head);
      setPhase({ name: "done", plan, commit });
      play("success");
      client.invalidateQueries({ queryKey: keys.updates });
    } catch (error) {
      play("error");
      setPhase({ name: "failed", message: error instanceof ApiError ? error.message : "" });
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: reviews once, when the dialog opens
  useEffect(() => {
    void review();
    return () => {
      closed.current = true;
    };
  }, []);

  // While files are being copied, closing would leave the update half done: Escape waits.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => event.key === "Escape" && !working && onClose();
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, working]);

  const total = "plan" in phase ? phase.plan.writes.length : 0;
  const copied = phase.name === "copying" ? phase.done : total;
  const percent = total ? Math.round((copied / total) * 100) : 100;

  return (
    <motion.div
      className="overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.16 } }}
      onMouseDown={(event) => event.target === event.currentTarget && !working && onClose()}
    >
      <motion.div
        className="dialog update-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="update-title"
        initial={{ opacity: 0, y: -8, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -4, scale: 0.98 }}
        transition={SPRING.sheet}
      >
        <header className="dialog-head">
          <h2 id="update-title">{t("updates.title")}</h2>
          {!working && (
            <button
              type="button"
              className="g-button g-button-ghost g-button-icon"
              aria-label={t("updates.close")}
              onClick={onClose}
            >
              <IconX size={16} stroke={1.5} />
            </button>
          )}
        </header>

        <section className="settings-section update-body" aria-live="polite">
          {phase.name === "reviewing" && <p className="muted">{t("updates.reviewing")}</p>}

          {phase.name === "confirm" && (
            <>
              <PlanSummary plan={phase.plan} />
              <ExternalLink href={phase.plan.url}>{t("updates.notes")}</ExternalLink>
              <div className="import-actions">
                {phase.plan.canApply ? (
                  <>
                    <button type="button" className="g-button g-button-ghost" onClick={onClose}>
                      {t("updates.cancel")}
                    </button>
                    <button type="button" className="g-button g-button-primary" onClick={() => void apply(phase.plan)}>
                      {t("updates.confirm", { version: phase.plan.to })}
                    </button>
                  </>
                ) : (
                  <ExternalLink href={MANUAL_UPDATE_URL}>{t("updates.manual")}</ExternalLink>
                )}
              </div>
            </>
          )}

          {(phase.name === "copying" || phase.name === "committing") && (
            <>
              <p>
                {phase.name === "copying" ? t("updates.copying", { done: phase.done, total }) : t("updates.committing")}
              </p>
              <div
                className="g-progress"
                data-state="running"
                role="progressbar"
                aria-label={t("updates.title")}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percent}
              >
                <motion.span
                  className="g-progress-bar spring-width"
                  animate={{ width: `${percent}%` }}
                  transition={SPRING.progress}
                />
              </div>
            </>
          )}

          {phase.name === "done" && (
            <>
              <p className="update-done">
                <IconCircleCheck size={18} stroke={1.5} aria-hidden="true" />
                {t("updates.done", { version: phase.commit.version, repository: phase.plan.repository })}
              </p>
              <div className="import-actions">
                <ExternalLink href={phase.commit.url}>{t("updates.seeCommit")}</ExternalLink>
                <button type="button" className="g-button g-button-primary" onClick={onClose}>
                  {t("updates.finish")}
                </button>
              </div>
            </>
          )}

          {phase.name === "failed" && (
            <>
              <p className="update-blocked" role="alert">
                <IconAlertTriangle size={16} stroke={1.5} aria-hidden="true" />
                {t("updates.failed", { message: phase.message })}
              </p>
              <div className="import-actions">
                <button type="button" className="g-button" onClick={() => void review()}>
                  {t("updates.retry")}
                </button>
              </div>
            </>
          )}
        </section>
      </motion.div>
    </motion.div>
  );
}
