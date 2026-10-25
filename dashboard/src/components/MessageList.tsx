import {
  IconAlertOctagon,
  IconArchive,
  IconFilePencil,
  IconInbox,
  IconKey,
  IconPaperclip,
  IconSearch,
  IconSend,
  IconShieldExclamation,
  IconTrash,
} from "@tabler/icons-react";
import { AnimatePresence, motion } from "motion/react";
import { memo, useEffect, useRef, useState } from "react";
import type { Mailbox, MessageSummary } from "../api/types";
import { useI18n } from "../i18n/I18nProvider";
import type { MessageKey } from "../i18n/translate";
import { formatListTime } from "../lib/format";
import { type Folder, MAX_QUERY_LENGTH } from "../lib/route";
import { Avatar, CopyIcon, useCopy } from "./controls";
import { RefreshButton } from "./RefreshButton";
import { useToast } from "./Toasts";
import { Tip } from "./Tooltip";

const EASE_OUT = [0.22, 1, 0.36, 1] as const;
const SKELETON_ROWS = 6;
/** Days Trash and Spam keep a message; the Worker's PERSONAL_BIN_RETENTION_DAYS. */
const TRASH_RETENTION_DAYS = 30;

export const FOLDER_LABELS: Record<Folder, MessageKey> = {
  inbox: "nav.inbox",
  sent: "nav.sent",
  drafts: "nav.drafts",
  archive: "nav.archive",
  spam: "nav.spam",
  trash: "nav.trash",
};

const EMPTY_STATES: Record<Folder, { Icon: typeof IconInbox; title: MessageKey; body: MessageKey }> = {
  inbox: { Icon: IconInbox, title: "list.emptyInboxTitle", body: "list.emptyInboxBody" },
  sent: { Icon: IconSend, title: "list.emptySentTitle", body: "list.emptySentBody" },
  drafts: { Icon: IconFilePencil, title: "drafts.emptyTitle", body: "drafts.emptyBody" },
  archive: { Icon: IconArchive, title: "list.emptyArchiveTitle", body: "list.emptyArchiveBody" },
  spam: { Icon: IconAlertOctagon, title: "list.emptySpamTitle", body: "list.emptySpamBody" },
  trash: { Icon: IconTrash, title: "list.emptyTrashTitle", body: "list.emptyTrashBody" },
};
const SEARCH_EMPTY_STATE = { Icon: IconSearch, title: "list.emptySearchTitle", body: "list.emptySearchBody" } as const;

interface MessageListProps {
  folder: Folder;
  /** Set while searching: the list shows the results instead of the folder. */
  query: string | null;
  mailbox: Mailbox | undefined;
  messages: MessageSummary[] | undefined;
  selectedId: string | null;
  freshIds: ReadonlySet<string>;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore(): void;
  onSelect(id: string): void;
  /** An empty search goes back to the inbox. */
  onSearch(query: string): void;
}

export const SEARCH_FIELD_ID = "mail-search";

function SearchField({ query, onSearch }: { query: string | null; onSearch(query: string): void }) {
  const { t } = useI18n();
  const [value, setValue] = useState(query ?? "");
  // Back and forward change the search too.
  useEffect(() => setValue(query ?? ""), [query]);
  return (
    <search>
      <form
        className="list-search"
        onSubmit={(event) => {
          event.preventDefault();
          onSearch(value);
        }}
      >
        <IconSearch size={14} stroke={1.5} aria-hidden="true" />
        <input
          id={SEARCH_FIELD_ID}
          type="search"
          value={value}
          maxLength={MAX_QUERY_LENGTH}
          placeholder={t("search.placeholder")}
          aria-label={t("search.label")}
          enterKeyHint="search"
          autoComplete="off"
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            setValue("");
            if (query) onSearch("");
            event.currentTarget.blur();
          }}
        />
        {!value && <kbd className="g-kbd">/</kbd>}
      </form>
    </search>
  );
}

function ListHeader({
  folder,
  query,
  mailbox,
  count,
  onSearch,
}: {
  folder: Folder;
  query: string | null;
  mailbox: Mailbox | undefined;
  count: number;
  onSearch(query: string): void;
}) {
  const { t, plural } = useI18n();
  const toast = useToast();
  const { copied, copy } = useCopy(() => toast(t("toast.addressCopied")));
  const unread = mailbox?.unread ?? 0;
  return (
    <div className="list-head">
      <div className="list-title">
        <h2 className="folder-title">{t(query ? "list.searchTitle" : FOLDER_LABELS[folder])}</h2>
        <div className="actions">
          <RefreshButton />
          {mailbox && (
            <Tip label={t("copy.address")}>
              <button
                type="button"
                className={`g-button g-button-ghost address-chip ${copied ? "copied" : ""}`}
                data-sound="none"
                onClick={() => copy(mailbox.address)}
              >
                <span className="mono">{mailbox.address}</span>
                <CopyIcon copied={copied} size={14} />
              </button>
            </Tip>
          )}
        </div>
      </div>
      <SearchField query={query} onSearch={onSearch} />
      <div className="meta-row">
        <span>{plural("list.count", count)}</span>
        {query && (
          <>
            <span className="sep" />
            <span>{t("list.searchScope")}</span>
          </>
        )}
        {!query && folder === "inbox" && unread > 0 && (
          <>
            <span className="sep" />
            <motion.span
              key={unread}
              className="unread-count"
              initial={{ y: -4, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
            >
              {t("list.unread", { count: unread })}
            </motion.span>
          </>
        )}
        {!query && (folder === "trash" || folder === "spam") && (
          <>
            <span className="sep" />
            <span>{t("list.trashRetention", { days: TRASH_RETENTION_DAYS })}</span>
          </>
        )}
      </div>
    </div>
  );
}

const MessageRow = memo(function MessageRow({
  message,
  showBox,
  selected,
  fresh,
  index,
  onSelect,
}: {
  message: MessageSummary;
  /** Search results come from several folders: archived ones say so. */
  showBox: boolean;
  selected: boolean;
  fresh: boolean;
  index: number;
  onSelect(id: string): void;
}) {
  const { t, locale, clock } = useI18n();
  const unread = message.direction === "received" && message.readAt === null;
  // Archive and Trash mix both directions: each row shows who it is from or to.
  const sent = message.direction === "sent";
  const title = sent
    ? t("list.to", { recipients: (message.recipients ?? []).join(", ") })
    : message.from.name || message.from.address || "?";
  const risky = message.risk.level !== "low";
  const archived = showBox && message.box === "archive";
  return (
    <motion.button
      layout="position"
      type="button"
      data-message-id={message.id}
      className={`msg ${selected ? "active" : ""} ${unread ? "unread" : ""} ${fresh ? "fresh" : ""}`}
      onClick={() => onSelect(message.id)}
      aria-current={selected ? "true" : undefined}
      initial={fresh ? { opacity: 0, y: -10 } : { opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -16, transition: { duration: 0.22, ease: EASE_OUT } }}
      transition={{ duration: fresh ? 0.52 : 0.28, ease: EASE_OUT, delay: fresh ? 0 : Math.min(index, 12) * 0.018 }}
    >
      {selected && (
        <motion.span
          layoutId="msg-selection"
          className="msg-bar"
          transition={{ type: "spring", stiffness: 500, damping: 40 }}
        />
      )}
      {sent ? (
        <span className="avatar avatar-sent" aria-hidden="true">
          <IconSend size={14} stroke={1.5} />
        </span>
      ) : (
        <Avatar name={message.from.name} address={message.from.address} />
      )}
      <div className="msg-body">
        <div className="top">
          <span className="from">{title}</span>
          <time dateTime={message.receivedAt}>{formatListTime(message.receivedAt, locale, clock)}</time>
        </div>
        <div className="subject">{message.subject || t("list.noSubject")}</div>
        {message.preview && <div className="snippet">{message.preview}</div>}
        {(message.codes.length > 0 || message.attachmentCount > 0 || risky || archived) && (
          <div className="chips">
            {archived && (
              <span className="g-chip">
                <IconArchive size={12} stroke={1.5} />
                {t("nav.archive")}
              </span>
            )}
            {message.codes.slice(0, 1).map((code) => (
              <span key={code} className="g-chip g-chip-mono" data-tone="accent">
                <IconKey size={12} stroke={1.5} />
                {code}
              </span>
            ))}
            {message.attachmentCount > 0 && (
              <Tip label={t("list.attachments")}>
                <span className="g-chip">
                  <IconPaperclip size={12} stroke={1.5} />
                  {message.attachmentCount}
                </span>
              </Tip>
            )}
            {risky && (
              <span className="g-chip" data-tone={message.risk.level === "high" ? "danger" : "warn"}>
                <IconShieldExclamation size={12} stroke={1.5} />
                {t(message.risk.level === "high" ? "detail.riskHigh" : "detail.riskMedium")}
              </span>
            )}
          </div>
        )}
      </div>
    </motion.button>
  );
});

function SkeletonRows() {
  return (
    <div aria-hidden="true">
      {Array.from({ length: SKELETON_ROWS }, (_, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: placeholders have no identity
        <div key={index} className="skeleton-row" style={{ opacity: 1 - index * 0.12 }}>
          <div className="skeleton" style={{ width: 28, height: 28, borderRadius: 99 }} />
          <div style={{ display: "grid", gap: 7 }}>
            <div className="skeleton" style={{ height: 10, width: "42%" }} />
            <div className="skeleton" style={{ height: 10, width: "86%" }} />
            <div className="skeleton" style={{ height: 10, width: "64%" }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState({ folder, query, address }: { folder: Folder; query: string | null; address: string }) {
  const { t } = useI18n();
  const { Icon, title, body } = query ? SEARCH_EMPTY_STATE : EMPTY_STATES[folder];
  return (
    <motion.div
      className="g-empty"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: EASE_OUT }}
    >
      <motion.span
        className="g-empty-icon"
        initial={{ scale: 0.8, rotate: -8 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ type: "spring", stiffness: 260, damping: 14, delay: 0.08 }}
      >
        <Icon size={26} stroke={1.5} />
      </motion.span>
      <p className="g-empty-title">{t(title)}</p>
      <p className="g-empty-body">{t(body, { address, days: TRASH_RETENTION_DAYS, query: query ?? "" })}</p>
    </motion.div>
  );
}

export function MessageList(props: MessageListProps) {
  const { folder, query, mailbox, messages, selectedId, freshIds, hasMore, loadingMore, onLoadMore, onSelect } = props;
  const { t } = useI18n();
  const sentinel = useRef<HTMLDivElement>(null);

  // More messages load as the end of the list scrolls into view.
  useEffect(() => {
    const element = sentinel.current;
    if (!element || !hasMore) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) onLoadMore();
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [hasMore, onLoadMore]);

  return (
    <section className="list" aria-label={t(query ? "list.searchTitle" : FOLDER_LABELS[folder])}>
      <ListHeader
        folder={folder}
        query={query}
        mailbox={mailbox}
        count={messages?.length ?? 0}
        onSearch={props.onSearch}
      />
      <div className="messages" key={query ? `search:${query}` : folder}>
        {!messages ? (
          <SkeletonRows />
        ) : messages.length === 0 ? (
          <EmptyState folder={folder} query={query} address={mailbox?.address ?? ""} />
        ) : (
          <AnimatePresence>
            {messages.map((message, index) => (
              <MessageRow
                key={message.id}
                message={message}
                showBox={query !== null}
                index={index}
                selected={message.id === selectedId}
                fresh={freshIds.has(message.id)}
                onSelect={onSelect}
              />
            ))}
          </AnimatePresence>
        )}
        {hasMore && (
          <div ref={sentinel} className="load-more">
            <button type="button" className="g-button g-button-ghost" onClick={onLoadMore} disabled={loadingMore}>
              {loadingMore ? t("list.loadingMore") : t("list.loadMore")}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
