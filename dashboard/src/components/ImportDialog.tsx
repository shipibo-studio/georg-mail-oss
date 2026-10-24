// Imports old mail (a Zoho export, .mbox or .eml files): the browser unpacks it and sends one message
// per request, a few at a time, so each request stays small for the Worker. Messages already in the
// mailbox are skipped by the Worker, so an interrupted import can be run again from the start.
import { IconFileZip, IconX } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { ApiError, api, SessionExpiredError } from "../api/client";
import { keys } from "../api/queries";
import type { ImportFolder } from "../api/types";
import { useI18n } from "../i18n/I18nProvider";
import type { MessageKey } from "../i18n/translate";
import { type ArchiveMessage, collectMessages, isImportable, MAX_MESSAGE_BYTES } from "../lib/mail-archive";

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
}

type Phase = "pick" | "reading" | "running" | "done";

export function ImportDialog({ onClose }: { onClose(): void }) {
  const { t, plural } = useI18n();
  const client = useQueryClient();
  const [files, setFiles] = useState<File[]>([]);
  const [folder, setFolder] = useState<ImportFolder>("inbox");
  const [phase, setPhase] = useState<Phase>("pick");
  const [progress, setProgress] = useState<Progress>({ total: 0, imported: 0, skipped: 0, failed: 0, stopped: null });
  const cancelled = useRef(false);

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

  async function importOne(message: ArchiveMessage): Promise<void> {
    const bytes = await message.read();
    if (bytes.length === 0 || bytes.length > MAX_MESSAGE_BYTES) return count("failed");
    try {
      const result = await api.importMessage(bytes, folder);
      count(result.status === "duplicate" ? "skipped" : "imported");
    } catch (error) {
      // A full mailbox or an ended session stops everything; anything else costs one message.
      if (error instanceof SessionExpiredError || (error instanceof ApiError && error.code === "plan_limit")) {
        cancelled.current = true;
        setProgress((current) => ({ ...current, stopped: error.message }));
      }
      count("failed");
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
    setProgress({ total: messages.length, imported: 0, skipped: 0, failed: 0, stopped: null });
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

  const handled = progress.imported + progress.skipped + progress.failed;
  const percent = progress.total ? Math.round((handled / progress.total) * 100) : 0;
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
          <section className="settings-section import-progress">
            {phase === "reading" ? (
              <p>{t("import.reading")}</p>
            ) : (
              <>
                <div
                  className="progress"
                  role="progressbar"
                  aria-label={t("import.title")}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={percent}
                >
                  <motion.span className="progress-bar" animate={{ width: `${percent}%` }} />
                </div>
                <p className="import-counts" aria-live="polite">
                  {t("import.counts", {
                    handled,
                    total: progress.total,
                    imported: progress.imported,
                    skipped: progress.skipped,
                    failed: progress.failed,
                  })}
                </p>
              </>
            )}
            {progress.stopped && (
              <p className="composer-error" role="alert">
                {progress.stopped}
              </p>
            )}
            {phase === "done" && (
              <p className="import-summary">
                {progress.total === 0 && !progress.stopped
                  ? t("import.nothingFound")
                  : plural("import.done", progress.imported)}
              </p>
            )}
            {phase === "running" ? (
              <button type="button" className="btn" onClick={() => (cancelled.current = true)}>
                {t("import.stop")}
              </button>
            ) : (
              phase === "done" && (
                <button type="button" className="btn primary" onClick={close}>
                  {t("import.close")}
                </button>
              )
            )}
          </section>
        )}
      </motion.div>
    </motion.div>
  );
}
