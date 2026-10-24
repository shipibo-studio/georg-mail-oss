import { IconAlertTriangle, IconLoader2, IconMinus, IconPaperclip, IconTrash, IconX } from "@tabler/icons-react";
import { MorphIcon } from "morphicons/react";
import { AnimatePresence, motion, useAnimationControls } from "motion/react";
import {
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { ApiError, api } from "../api/client";
import { useDeleteDraft, useSaveDraft, useSendMessage } from "../api/queries";
import type { Mailbox } from "../api/types";
import { useI18n } from "../i18n/I18nProvider";
import { admitFiles, type DraftFile, filesProblem, uploadIds } from "../lib/attachments";
import { draftInput, isBlankDraft } from "../lib/drafts";
import { formatBytes } from "../lib/format";
import { useIsPhone } from "../lib/media";
import { isValidAddress, splitRecipients, uniqueRecipients } from "../lib/recipients";
import type { Draft } from "../lib/reply";
import { CHECK_ICON, SEND_ICON } from "./morph-icons";
import { useToast } from "./Toasts";
import { Tip } from "./Tooltip";

const MAX_RECIPIENTS = 10;
const CLOSE_AFTER_SENT_MS = 700;
const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform);
// Used until the mailbox has loaded; the Worker's own limits always apply.
const DEFAULT_LIMITS = { maxBytes: 5 * 1024 * 1024, maxFiles: 10 };

export interface ComposerState {
  draft: Draft;
  /** One key per draft: retrying a failed send can never deliver twice. */
  idempotencyKey: string;
  /** The saved draft this is, once autosave has created it (or when a kept draft was opened). */
  draftId: string | null;
}

export function newComposerState(draft: Draft, draftId: string | null = null): ComposerState {
  return { draft, idempotencyKey: crypto.randomUUID(), draftId };
}

/** Saves after a pause in typing. */
const AUTOSAVE_DELAY_MS = 1_500;
type SaveStatus = "idle" | "saving" | "saved" | "failed";

/**
 * Keeps the draft saved while the owner writes: a pause in typing saves it, and so does closing the
 * composer. One save runs at a time; changes made meanwhile are saved right after. Nothing is
 * saved until something is written, nor once the message is sent or discarded.
 */
function useDraftAutosave(
  state: ComposerState,
  onChange: ComposerProps["onChange"],
  stopped: boolean,
): { status: SaveStatus; draftId(): string | null; stop(): void } {
  const save = useSaveDraft();
  const [status, setStatus] = useState<SaveStatus>(state.draftId ? "saved" : "idle");
  const latest = useRef(state);
  latest.current = state;
  // Known as soon as the draft is created, before the parent's state catches up.
  const draftId = useRef(state.draftId);
  const saved = useRef(state.draftId ? JSON.stringify(draftInput(state.draft)) : null);
  const inFlight = useRef(false);
  const again = useRef(false);
  const halted = useRef(false);
  halted.current = halted.current || stopped;

  const run = useCallback(async () => {
    if (halted.current) return;
    if (inFlight.current) {
      again.current = true;
      return;
    }
    const { draft } = latest.current;
    const input = draftInput(draft);
    const fingerprint = JSON.stringify(input);
    const uploading = draft.files.some((file) => file.status === "uploading");
    if (fingerprint === saved.current || uploading || (!draftId.current && isBlankDraft(draft))) return;
    inFlight.current = true;
    setStatus("saving");
    try {
      const result = await save.mutateAsync({ id: draftId.current, input });
      saved.current = fingerprint;
      if (!draftId.current) {
        draftId.current = result.id;
        onChange((current) => ({ ...current, draftId: result.id }));
      }
      setStatus("saved");
    } catch {
      setStatus("failed");
    } finally {
      inFlight.current = false;
      if (again.current) {
        again.current = false;
        void run();
      }
    }
  }, [onChange, save]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: every change to the draft restarts the pause
  useEffect(() => {
    if (stopped) return;
    const timer = setTimeout(() => void run(), AUTOSAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [state.draft, stopped, run]);
  // Closing the composer saves what the pause did not get to.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only when the composer closes
  useEffect(() => () => void run(), []);

  return {
    status,
    draftId: () => draftId.current,
    stop: () => {
      halted.current = true;
    },
  };
}

function RecipientField({
  label,
  values,
  onChange,
  autoFocus,
  invalid,
}: {
  label: string;
  values: string[];
  onChange(values: string[]): void;
  autoFocus?: boolean;
  invalid: boolean;
}) {
  const { t } = useI18n();
  const [text, setText] = useState("");
  const commit = (input: string) => {
    const found = splitRecipients(input);
    if (found.length > 0) onChange(uniqueRecipients(values, found));
    setText("");
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (["Enter", ",", ";", "Tab"].includes(event.key) && text.trim()) {
      if (event.key !== "Tab") event.preventDefault();
      commit(text);
    } else if (event.key === "Backspace" && !text && values.length > 0) {
      onChange(values.slice(0, -1));
    }
  };
  const onPaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const pasted = event.clipboardData.getData("text");
    if (/[,;\s<]/.test(pasted)) {
      event.preventDefault();
      commit(`${text} ${pasted}`);
    }
  };
  return (
    <label className={`field recipients ${invalid ? "invalid" : ""}`}>
      <span className="field-label">{label}</span>
      <div className="chip-input">
        <AnimatePresence initial={false}>
          {values.map((address) => (
            <motion.span
              key={address}
              layout
              className={`recipient ${isValidAddress(address) ? "" : "bad"}`}
              initial={{ opacity: 0, scale: 0.85 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.85, transition: { duration: 0.14 } }}
              transition={{ type: "spring", stiffness: 600, damping: 30 }}
            >
              <Tip label={isValidAddress(address) ? address : t("compose.invalidAddress", { address })} wrapAnywhere>
                <span className="mono">{address}</span>
              </Tip>
              <button
                type="button"
                aria-label={t("compose.removeRecipient", { address })}
                onClick={() => onChange(values.filter((value) => value !== address))}
              >
                <IconX size={12} stroke={2} />
              </button>
            </motion.span>
          ))}
        </AnimatePresence>
        <input
          // biome-ignore lint/a11y/noAutofocus: the composer opens to write a message
          autoFocus={autoFocus}
          value={text}
          inputMode="email"
          autoComplete="email"
          spellCheck={false}
          placeholder={values.length === 0 ? t("compose.recipientsPlaceholder") : ""}
          onChange={(event) => {
            // A separator typed or pasted (mobile keyboards send no key events) completes the address.
            const value = event.target.value;
            if (/[,;]/.test(value)) commit(value);
            else setText(value);
          }}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onBlur={() => text.trim() && commit(text)}
        />
      </div>
    </label>
  );
}

function validate(draft: Draft, t: ReturnType<typeof useI18n>["t"]): string | null {
  const all = uniqueRecipients(draft.to, draft.cc);
  if (draft.to.length === 0) return t("compose.needsRecipient");
  const bad = all.find((address) => !isValidAddress(address));
  if (bad) return t("compose.invalidAddress", { address: bad });
  if (all.length > MAX_RECIPIENTS) return t("compose.tooManyRecipients", { max: MAX_RECIPIENTS });
  if (!draft.subject.trim()) return t("compose.needsSubject");
  if (!draft.text.trim()) return t("compose.needsBody");
  return null;
}

function FileChip({ file, onRemove }: { file: DraftFile; onRemove(): void }) {
  const { t, locale } = useI18n();
  return (
    <motion.li
      layout
      className={`file-chip ${file.status}`}
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.14 } }}
      transition={{ type: "spring", stiffness: 600, damping: 32 }}
    >
      {file.status === "uploading" ? (
        <IconLoader2 size={14} stroke={1.5} className="spin" aria-label={t("compose.uploading")} />
      ) : file.status === "failed" ? (
        <IconAlertTriangle size={14} stroke={1.5} />
      ) : (
        <IconPaperclip size={14} stroke={1.5} />
      )}
      <Tip label={file.error ?? file.name} wrapAnywhere>
        <span className="file-name">{file.name}</span>
      </Tip>
      <span className="file-size">{formatBytes(file.sizeBytes, locale)}</span>
      <button type="button" aria-label={t("compose.removeFile", { name: file.name })} onClick={onRemove}>
        <IconX size={12} stroke={2} />
      </button>
    </motion.li>
  );
}

interface ComposerProps {
  state: ComposerState;
  mailbox: Mailbox | undefined;
  /** Updates take the latest state: uploads finish after the draft has moved on. */
  onChange(update: (state: ComposerState) => ComposerState): void;
  onClose(): void;
  onDiscard(): void;
  onSent(): void;
}

export function Composer({ state, mailbox, onChange, onClose, onDiscard, onSent }: ComposerProps) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const send = useSendMessage();
  const shake = useAnimationControls();
  const isPhone = useIsPhone();
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [showCc, setShowCc] = useState(state.draft.cc.length > 0);
  const [dragging, setDragging] = useState(false);
  const autosave = useDraftAutosave(state, onChange, sent);
  const removeDraft = useDeleteDraft();
  const body = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const { draft } = state;
  const isReply = draft.inReplyTo !== null;
  const limits = mailbox
    ? { maxBytes: mailbox.attachmentsMaxBytes, maxFiles: mailbox.attachmentsMaxFiles }
    : DEFAULT_LIMITS;
  const update = (changes: Partial<Draft>) => {
    setError(null);
    onChange((current) => ({ ...current, draft: { ...current.draft, ...changes } }));
  };
  const updateFiles = (change: (files: DraftFile[]) => DraftFile[]) =>
    onChange((current) => ({ ...current, draft: { ...current.draft, files: change(current.draft.files) } }));
  const settle = (key: string, changes: Partial<DraftFile>) =>
    updateFiles((files) => files.map((file) => (file.key === key ? { ...file, ...changes } : file)));

  // Each file uploads as soon as it is picked, on its own request.
  const addFiles = (picked: File[]) => {
    const { admitted, problem } = admitFiles(draft.files, picked, limits);
    setError(problem ? t(problem, { max: limits.maxFiles, size: formatBytes(limits.maxBytes, locale) }) : null);
    const added = admitted.map((file) => ({ file, key: crypto.randomUUID() }));
    updateFiles((files) => [
      ...files,
      ...added.map(({ file, key }) => ({
        key,
        name: file.name,
        sizeBytes: file.size,
        uploadId: null,
        status: "uploading" as const,
        error: null,
      })),
    ]);
    for (const { file, key } of added) {
      api.upload(file).then(
        (uploaded) => settle(key, { uploadId: uploaded.id, name: uploaded.filename, status: "ready" }),
        (caught) =>
          settle(key, { status: "failed", error: caught instanceof ApiError ? caught.message : t("error.generic") }),
      );
    }
  };
  const removeFile = (file: DraftFile) => {
    setError(null);
    updateFiles((files) => files.filter((item) => item.key !== file.key));
    if (file.uploadId) api.removeUpload(file.uploadId).catch(() => {});
  };
  // Files of a discarded draft are deleted now; the cron would only get to them a day later.
  const discard = () => {
    autosave.stop();
    const draftId = autosave.draftId();
    // A kept draft takes its files with it; otherwise each upload is removed on its own.
    if (draftId) removeDraft.mutate(draftId);
    else for (const id of uploadIds(draft.files)) api.removeUpload(id).catch(() => {});
    onDiscard();
  };
  const onDrop = (event: DragEvent) => {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    setDragging(false);
    addFiles([...event.dataTransfer.files]);
  };

  // A reply starts with the cursor above the quoted text.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only when the composer opens
  useEffect(() => {
    if (isReply && body.current) {
      body.current.focus();
      body.current.setSelectionRange(0, 0);
      body.current.scrollTop = 0;
    }
  }, []);

  const submit = async () => {
    if (send.isPending || sent) return;
    const filesIssue = filesProblem(draft.files);
    const problem = validate(draft, t) ?? (filesIssue ? t(filesIssue) : null);
    if (problem) {
      setError(problem);
      shake.start({ x: [0, -6, 6, -4, 4, 0], transition: { duration: 0.36 } });
      return;
    }
    try {
      await send.mutateAsync({
        idempotencyKey: state.idempotencyKey,
        message: {
          to: draft.to,
          cc: draft.cc,
          subject: draft.subject.trim(),
          text: draft.text,
          ...(draft.inReplyTo ? { inReplyTo: draft.inReplyTo } : {}),
          ...(draft.from ? { from: draft.from } : {}),
          ...(draft.files.length > 0 ? { attachments: uploadIds(draft.files) } : {}),
          ...(autosave.draftId() ? { draftId: autosave.draftId() ?? undefined } : {}),
        },
      });
      autosave.stop();
      setSent(true);
      toast(t("toast.sent"));
      setTimeout(onSent, CLOSE_AFTER_SENT_MS);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : t("error.generic"));
      shake.start({ x: [0, -6, 6, -4, 4, 0], transition: { duration: 0.36 } });
    }
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void submit();
    } else if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  };

  return (
    <motion.div
      className="composer"
      role="dialog"
      aria-label={t(isReply ? "compose.reply" : "compose.newMessage")}
      // A floating panel on desktop; a sheet that slides up from the bottom on phones.
      initial={isPhone ? { y: "100%" } : { opacity: 0, y: 28, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={
        isPhone
          ? { y: "100%", transition: { duration: 0.22 } }
          : { opacity: 0, y: 20, scale: 0.98, transition: { duration: 0.18 } }
      }
      transition={{ type: "spring", stiffness: 380, damping: 32 }}
      onKeyDown={onKeyDown}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={onDrop}
    >
      <motion.div animate={shake} className={`composer-inner ${dragging ? "dragging" : ""}`}>
        {dragging && <div className="drop-hint">{t("compose.dropFiles")}</div>}
        <header className="composer-head">
          <span className="composer-title">{t(isReply ? "compose.reply" : "compose.newMessage")}</span>
          <Tip label={`${t("compose.close")} (Esc)`}>
            <button type="button" className="btn ghost icon" aria-label={t("compose.close")} onClick={onClose}>
              <IconMinus size={16} stroke={1.5} />
            </button>
          </Tip>
        </header>

        {mailbox && mailbox.aliases.length > 0 ? (
          <label className="field from-field">
            <span className="field-label">{t("compose.from")}</span>
            <select
              className="from-select mono"
              value={draft.from ?? mailbox.address}
              onChange={(event) => update({ from: event.target.value === mailbox.address ? null : event.target.value })}
            >
              {[mailbox.address, ...mailbox.aliases].map((address) => (
                <option key={address} value={address}>
                  {address}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <div className="field static">
            <span className="field-label">{t("compose.from")}</span>
            <span className="mono">{mailbox?.address}</span>
          </div>
        )}
        <div className="recipient-row">
          <RecipientField
            label={t("compose.to")}
            values={draft.to}
            onChange={(to) => update({ to })}
            autoFocus={!isReply}
            invalid={Boolean(error) && draft.to.length === 0}
          />
          {!showCc && (
            <button type="button" className="btn ghost cc-toggle" onClick={() => setShowCc(true)}>
              {t("compose.addCc")}
            </button>
          )}
        </div>
        <AnimatePresence initial={false}>
          {showCc && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.22 }}
            >
              <RecipientField
                label={t("compose.cc")}
                values={draft.cc}
                onChange={(cc) => update({ cc })}
                autoFocus
                invalid={false}
              />
            </motion.div>
          )}
        </AnimatePresence>
        <label className="field">
          <span className="field-label">{t("compose.subject")}</span>
          <input value={draft.subject} onChange={(event) => update({ subject: event.target.value })} maxLength={998} />
        </label>
        <textarea
          ref={body}
          className="composer-body"
          value={draft.text}
          placeholder={t("compose.body")}
          onChange={(event) => update({ text: event.target.value })}
          maxLength={15_000}
        />

        {draft.files.length > 0 && (
          <ul className="composer-files" aria-label={t("compose.attachments")}>
            <AnimatePresence initial={false}>
              {draft.files.map((file) => (
                <FileChip key={file.key} file={file} onRemove={() => removeFile(file)} />
              ))}
            </AnimatePresence>
          </ul>
        )}

        <footer className="composer-foot">
          <motion.button
            type="button"
            className={`btn primary send ${sent ? "sent" : ""}`}
            onClick={() => void submit()}
            disabled={send.isPending}
            whileTap={{ scale: 0.96 }}
          >
            <MorphIcon
              icon={sent ? CHECK_ICON : SEND_ICON}
              size={16}
              strokeWidth={1.5}
              spring="bouncy"
              reducedMotion="user"
            />
            <span className="swap-label">
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.span
                  key={sent ? "sent" : send.isPending ? "sending" : "send"}
                  initial={{ y: 8, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  exit={{ y: -8, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  {t(sent ? "compose.sent" : send.isPending ? "compose.sending" : "compose.send")}
                </motion.span>
              </AnimatePresence>
            </span>
          </motion.button>
          <Tip label={t("compose.attach")}>
            <button
              type="button"
              className="btn ghost icon"
              aria-label={t("compose.attach")}
              onClick={() => picker.current?.click()}
            >
              <IconPaperclip size={16} stroke={1.5} />
            </button>
          </Tip>
          <input
            ref={picker}
            type="file"
            multiple
            hidden
            data-testid="attach-input"
            onChange={(event) => {
              addFiles([...(event.target.files ?? [])]);
              event.target.value = "";
            }}
          />
          <span className="muted small hint">{t("compose.shortcut", { key: IS_MAC ? "⌘" : "Ctrl" })}</span>
          {autosave.status !== "idle" && (
            <span className={`muted small draft-status status-${autosave.status}`} aria-live="polite">
              {t(`compose.draft.${autosave.status}`)}
            </span>
          )}
          <span className="grow" />
          <AnimatePresence>
            {error && (
              <motion.span
                className="composer-error"
                role="alert"
                initial={{ opacity: 0, x: 6 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0 }}
              >
                {error}
              </motion.span>
            )}
          </AnimatePresence>
          <Tip label={t("compose.discard")}>
            <button type="button" className="btn ghost icon" aria-label={t("compose.discard")} onClick={discard}>
              <IconTrash size={16} stroke={1.5} />
            </button>
          </Tip>
        </footer>
        {mailbox && (
          <div className="composer-limit muted small">{t("compose.dailyLimit", { max: mailbox.sendsPerDay })}</div>
        )}
      </motion.div>
    </motion.div>
  );
}
