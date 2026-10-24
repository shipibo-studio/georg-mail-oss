// Imports old mail (a Zoho export, .mbox or .eml files): the browser unpacks it and sends one message
// per request, a few at a time, so each request stays small for the Worker. Messages already in the
// mailbox are skipped by the Worker, so an interrupted import can be run again from the start.
import { IconAlertTriangle, IconFileZip, IconPlayerStop, IconX } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { MorphIcon } from "morphicons/react";
import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { ApiError, api, SessionExpiredError } from "../api/client";
import { keys } from "../api/queries";
import type { ImportFolder } from "../api/types";
import { useI18n } from "../i18n/I18nProvider";
import type { MessageKey } from "../i18n/translate";
import { type ArchiveMessage, collectMessages, isImportable, MAX_MESSAGE_BYTES } from "../lib/mail-archive";
import { useNow } from "./controls";
import { CHECK_ICON, DOWNLOAD_ICON, X_ICON } from "./morph-icons";

/** Messages in flight at once: enough to keep the line busy, few enough to stay polite. */
const PARALLEL_UPLOADS = 3;
const FOLDERS: { folder: ImportFolder; label: MessageKey }[] = [
  { folder: "inbox", label: "nav.inbox" },
  { folder: "archive", label: "nav.archive" },
  { folder: "sent", label: "nav.sent" },
];

interface Progress {
  total: number;
  imported: number;
  skipped: number;
  failed: number;
  /** Why the import stopped before the end, if it did. */
  stopped: string | null;
  /** While the Worker's rate limit holds the import back, when it resumes. */
  pausedUntil: number | null;
}

type Phase = "pick" | "reading" | "running" | "done";

/** A 429 pauses the import this long when it does not say how long, and at most this many times per message. */
const DEFAULT_RATE_LIMIT_WAIT_MS = 60_000;
const MAX_RATE_LIMIT_WAITS = 5;
const PAUSE_CHECK_MS = 250;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Below this, the pace is too young to promise a time left. */
const ETA_MIN_MESSAGES = 5;
const ETA_MIN_ELAPSED_MS = 3_000;
const MINUTE_MS = 60_000;

/** Minutes left at the pace so far, or null while there is not enough to tell. */
export function minutesLeft(handled: number, total: number, elapsedMs: number): number | null {
  if (handled < ETA_MIN_MESSAGES || elapsedMs < ETA_MIN_ELAPSED_MS || handled >= total) return null;
  const msPerMessage = elapsedMs / handled;
  return Math.ceil(((total - handled) * msPerMessage) / MINUTE_MS);
}

/** The import's state at a glance: how far it is, how long is left, and what happened to each message. */
function ImportProgressView({
  phase,
  progress,
  startedAt,
  onStop,
  onClose,
}: {
  phase: Exclude<Phase, "pick">;
  progress: Progress;
  startedAt: number;
  onStop(): void;
  onClose(): void;
}) {
  const { t, plural } = useI18n();
  // Ticks the time left and the countdown of a pause.
  const now = useNow(1_000);
  const handled = progress.imported + progress.skipped + progress.failed;
  const percent = progress.total ? Math.round((handled / progress.total) * 100) : 0;
  const counts = t("import.counts", {
    handled,
    total: progress.total,
    imported: progress.imported,
    skipped: progress.skipped,
    failed: progress.failed,
  });
  const running = phase === "running";
  const finished = phase === "done";
  const troubled = Boolean(progress.stopped) || progress.failed > 0;
  const tone = troubled ? "warn" : finished ? "done" : "running";
  const pauseSeconds =
    running && progress.pausedUntil ? Math.max(0, Math.ceil((progress.pausedUntil - now) / 1000)) : 0;
  const minutes = running && pauseSeconds === 0 ? minutesLeft(handled, progress.total, now - startedAt) : null;

  if (phase === "reading") {
    return (
      <section className="settings-section import-progress" data-tone="running">
        <p className="import-of">{t("import.reading")}</p>
        <div className="progress indeterminate" role="progressbar" aria-label={t("import.reading")}>
          <span className="progress-bar" />
        </div>
      </section>
    );
  }
  return (
    <section className="settings-section import-progress" data-tone={tone} data-state={finished ? "done" : "running"}>
      <div className="import-headline">
        {/* One icon throughout: the download arrow morphs into a check, or an X when something failed. */}
        <motion.span
          className="import-badge"
          animate={finished ? { scale: [1, 1.18, 1] } : { scale: 1 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        >
          <MorphIcon
            icon={finished ? (troubled ? X_ICON : CHECK_ICON) : DOWNLOAD_ICON}
            size={finished ? 22 : 16}
            strokeWidth={2}
            reducedMotion="user"
          />
        </motion.span>
        <span className="import-percent">{percent}%</span>
        <span className="import-of">{t("import.of", { handled, total: progress.total })}</span>
        {pauseSeconds > 0 ? (
          <span className="import-eta paused">{t("import.paused", { seconds: pauseSeconds })}</span>
        ) : (
          minutes !== null && (
            <span className="import-eta">{minutes <= 1 ? t("import.etaSoon") : plural("import.eta", minutes)}</span>
          )
        )}
      </div>
      <div
        className={`progress ${running && pauseSeconds === 0 ? "active" : ""}`}
        role="progressbar"
        aria-label={t("import.title")}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={counts}
      >
        <motion.span
          className="progress-bar"
          initial={false}
          animate={{ width: `${percent}%` }}
          transition={{ type: "spring", stiffness: 140, damping: 26 }}
        />
      </div>
      <ul className="import-stats" aria-live="polite">
        <li className="import-stat imported">
          <strong>{progress.imported}</strong> {t("import.statImported")}
        </li>
        <li className="import-stat skipped">
          <strong>{progress.skipped}</strong> {t("import.statSkipped")}
        </li>
        <li className={`import-stat failed ${progress.failed > 0 ? "nonzero" : ""}`}>
          <strong>{progress.failed}</strong> {t("import.statFailed")}
        </li>
      </ul>
      {progress.stopped && (
        <p className="import-alert" role="alert">
          <IconAlertTriangle size={14} stroke={1.5} />
          {progress.stopped}
        </p>
      )}
      {finished && (
        <motion.p
          className="import-summary"
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
        >
          {progress.total === 0 && !progress.stopped
            ? t("import.nothingFound")
            : plural("import.done", progress.imported)}
          {progress.failed > 0 && !progress.stopped && <span className="import-retry"> {t("import.retryHint")}</span>}
        </motion.p>
      )}
      <div className="import-actions">
        {running ? (
          <button type="button" className="btn ghost" onClick={onStop}>
            <IconPlayerStop size={14} stroke={1.5} />
            {t("import.stop")}
          </button>
        ) : (
          <button type="button" className="btn primary import-close" onClick={onClose}>
            {t("import.close")}
          </button>
        )}
      </div>
    </section>
  );
}

export function ImportDialog({ onClose }: { onClose(): void }) {
  const { t } = useI18n();
  const client = useQueryClient();
  const [files, setFiles] = useState<File[]>([]);
  const [folder, setFolder] = useState<ImportFolder>("inbox");
  const [phase, setPhase] = useState<Phase>("pick");
  const [progress, setProgress] = useState<Progress>({
    total: 0,
    imported: 0,
    skipped: 0,
    failed: 0,
    stopped: null,
    pausedUntil: null,
  });
  const cancelled = useRef(false);
  const startedAt = useRef(0);

  const close = () => {
    cancelled.current = true;
    onClose();
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: close only reads refs and the prop
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => event.key === "Escape" && close();
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const count = (field: "imported" | "skipped" | "failed") =>
    setProgress((current) => ({ ...current, [field]: current[field] + 1 }));

  /** Waits out the Worker's rate limit, showing when the import resumes; a Stop ends the wait. */
  async function pause(ms: number): Promise<void> {
    const until = Date.now() + ms;
    setProgress((current) => ({ ...current, pausedUntil: Math.max(current.pausedUntil ?? 0, until) }));
    while (!cancelled.current && Date.now() < until) await sleep(PAUSE_CHECK_MS);
    setProgress((current) => ({
      ...current,
      pausedUntil: (current.pausedUntil ?? 0) > Date.now() ? current.pausedUntil : null,
    }));
  }

  async function importOne(message: ArchiveMessage): Promise<void> {
    const bytes = await message.read();
    if (bytes.length === 0 || bytes.length > MAX_MESSAGE_BYTES) return count("failed");
    for (let waits = 0; ; waits++) {
      try {
        const result = await api.importMessage(bytes, folder);
        return count(result.status === "duplicate" ? "skipped" : "imported");
      } catch (error) {
        // Too fast for the Worker's limit: wait as it asks and send the same message again.
        if (error instanceof ApiError && error.status === 429 && waits < MAX_RATE_LIMIT_WAITS && !cancelled.current) {
          await pause(error.retryAfterMs ?? DEFAULT_RATE_LIMIT_WAIT_MS);
          if (!cancelled.current) continue;
        }
        // A full mailbox or an ended session stops everything; anything else costs one message.
        if (error instanceof SessionExpiredError || (error instanceof ApiError && error.code === "plan_limit")) {
          cancelled.current = true;
          setProgress((current) => ({ ...current, stopped: error.message }));
        }
        return count("failed");
      }
    }
  }

  async function start() {
    cancelled.current = false;
    setPhase("reading");
    let messages: ArchiveMessage[];
    try {
      messages = await collectMessages(files);
    } catch {
      setProgress((current) => ({ ...current, stopped: t("import.unreadable") }));
      setPhase("done");
      return;
    }
    setProgress({ total: messages.length, imported: 0, skipped: 0, failed: 0, stopped: null, pausedUntil: null });
    startedAt.current = Date.now();
    setPhase("running");
    let next = 0;
    const worker = async () => {
      while (!cancelled.current && next < messages.length) {
        const message = messages[next++];
        if (message) await importOne(message);
      }
    };
    await Promise.all(Array.from({ length: PARALLEL_UPLOADS }, worker));
    client.invalidateQueries({ queryKey: ["messages"] });
    client.invalidateQueries({ queryKey: keys.mailbox });
    setPhase("done");
  }

  return (
    <motion.div
      className="overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.16 } }}
      onMouseDown={(event) => event.target === event.currentTarget && phase !== "running" && close()}
    >
      <motion.div
        className="dialog import-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-title"
        initial={{ opacity: 0, y: -8, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -4, scale: 0.98 }}
        transition={{ type: "spring", stiffness: 420, damping: 32 }}
      >
        <header className="dialog-head">
          <h2 id="import-title">{t("import.title")}</h2>
          <button type="button" className="btn ghost icon" aria-label={t("import.close")} onClick={close}>
            <IconX size={16} stroke={1.5} />
          </button>
        </header>

        {phase === "pick" && (
          <section className="settings-section import-pick">
            <p className="muted small">{t("import.howTo")}</p>
            <label className="btn import-files">
              <IconFileZip size={16} stroke={1.5} />
              {t("import.choose")}
              <input
                type="file"
                multiple
                hidden
                accept=".zip,.mbox,.mbx,.eml"
                data-testid="import-input"
                onChange={(event) =>
                  setFiles([...(event.target.files ?? [])].filter((file) => isImportable(file.name)))
                }
              />
            </label>
            {files.length > 0 && (
              <ul className="import-file-list">
                {files.map((file) => (
                  <li key={`${file.name}-${file.size}`} className="mono small">
                    {file.name}
                  </li>
                ))}
              </ul>
            )}
            <div className="setting compact">
              <label className="setting-text" htmlFor="import-folder">
                {t("import.folder")}
              </label>
              <select
                id="import-folder"
                className="select"
                value={folder}
                onChange={(event) => setFolder(event.target.value as ImportFolder)}
              >
                {FOLDERS.map((option) => (
                  <option key={option.folder} value={option.folder}>
                    {t(option.label)}
                  </option>
                ))}
              </select>
            </div>
            <p className="muted small">{t("import.note")}</p>
            <button type="button" className="btn primary" disabled={files.length === 0} onClick={() => void start()}>
              {t("import.start")}
            </button>
          </section>
        )}

        {phase !== "pick" && (
          <ImportProgressView
            phase={phase}
            progress={progress}
            startedAt={startedAt.current}
            onStop={() => {
              cancelled.current = true;
            }}
            onClose={close}
          />
        )}
      </motion.div>
    </motion.div>
  );
}
