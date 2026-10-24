// The Drafts folder: messages still being written, newest first. Opening one brings it back to the
// composer; they are saved as they are typed, from any device.
import { IconFilePencil, IconTrash } from "@tabler/icons-react";
import { AnimatePresence, motion } from "motion/react";
import { useDeleteDraft, useDrafts } from "../api/queries";
import type { SavedDraft } from "../api/types";
import { useI18n } from "../i18n/I18nProvider";
import { formatListTime } from "../lib/format";
import { EmptyPanel } from "./controls";
import { RefreshButton } from "./RefreshButton";
import { useToast } from "./Toasts";
import { Tip } from "./Tooltip";

const EASE_OUT = [0.22, 1, 0.36, 1] as const;
const PREVIEW_CHARS = 140;

function DraftRow({ draft, index, onOpen }: { draft: SavedDraft; index: number; onOpen(draft: SavedDraft): void }) {
  const { t, locale, clock } = useI18n();
  const toast = useToast();
  const remove = useDeleteDraft();
  const recipients = [...draft.to, ...draft.cc].filter(Boolean);
  const preview = draft.text.replace(/\s+/g, " ").trim().slice(0, PREVIEW_CHARS);
  return (
    <motion.div
      layout="position"
      className="draft-row"
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -16, transition: { duration: 0.22, ease: EASE_OUT } }}
      transition={{ duration: 0.28, ease: EASE_OUT, delay: Math.min(index, 12) * 0.018 }}
    >
      <button type="button" className="msg draft-open" onClick={() => onOpen(draft)}>
        <span className="avatar avatar-sent" aria-hidden="true">
          <IconFilePencil size={14} stroke={1.5} />
        </span>
        <span className="msg-body">
          <span className="top">
            <span className="from">
              {recipients.length > 0 ? t("list.to", { recipients: recipients.join(", ") }) : t("drafts.noRecipients")}
            </span>
            <time dateTime={draft.updatedAt}>{formatListTime(draft.updatedAt, locale, clock)}</time>
          </span>
          <span className="subject">{draft.subject || t("list.noSubject")}</span>
          {preview && <span className="snippet">{preview}</span>}
        </span>
      </button>
      <Tip label={t("drafts.delete")}>
        <button
          type="button"
          className="btn ghost icon draft-delete"
          aria-label={t("drafts.delete")}
          onClick={() => remove.mutate(draft.id, { onSuccess: () => toast(t("drafts.deleted")) })}
        >
          <IconTrash size={16} stroke={1.5} />
        </button>
      </Tip>
    </motion.div>
  );
}

export function DraftsView({ onOpen }: { onOpen(draft: SavedDraft): void }) {
  const { t, plural } = useI18n();
  const drafts = useDrafts();
  return (
    <>
      <section className="list" aria-label={t("nav.drafts")}>
        <div className="list-head">
          <div className="list-title">
            <h2 className="folder-title">{t("nav.drafts")}</h2>
            <div className="actions">
              <RefreshButton />
            </div>
          </div>
          <div className="meta-row">{plural("drafts.count", drafts.data?.length ?? 0)}</div>
        </div>
        <div className="messages">
          {drafts.data?.length === 0 && (
            <EmptyPanel
              icon={<IconFilePencil size={26} stroke={1.5} />}
              title={t("drafts.emptyTitle")}
              body={t("drafts.emptyBody")}
            />
          )}
          <AnimatePresence>
            {drafts.data?.map((draft, index) => (
              <DraftRow key={draft.id} draft={draft} index={index} onOpen={onOpen} />
            ))}
          </AnimatePresence>
        </div>
      </section>
      <main className="detail">
        <div className="detail-empty">
          <EmptyPanel
            icon={<IconFilePencil size={28} stroke={1.5} />}
            title={t("drafts.selectTitle")}
            body={t("drafts.selectHint")}
          />
        </div>
      </main>
    </>
  );
}
