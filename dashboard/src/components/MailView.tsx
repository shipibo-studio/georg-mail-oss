// The personal mailbox (oi@): folder list and message, with the mail client's keyboard.
// Deleting is two steps, as in other mail clients: a message goes to Trash (with Undo), and only
// Trash deletes for good, by hand or after 30 days.
import {
  IconAlertOctagon,
  IconArchive,
  IconInbox,
  IconMailCheck,
  IconRestore,
  IconSend,
  IconTrash,
} from "@tabler/icons-react";
import { motion } from "motion/react";
import { type ReactNode, useCallback, useEffect, useMemo } from "react";
import { useDeleteMessage, useFolder, useMessage, useMoveMessage, useSearch } from "../api/queries";
import type { FullMessage, MailBox, Mailbox, SenderVerdict } from "../api/types";
import { useI18n } from "../i18n/I18nProvider";
import type { Folder, Route } from "../lib/route";
import { isTyping } from "./keyboard";
import { MessageDetail } from "./MessageDetail";
import { MessageList, SEARCH_FIELD_ID } from "./MessageList";
import { useToast } from "./Toasts";
import { Tip } from "./Tooltip";

const MOVED_TOAST = { archive: "toast.archived", trash: "toast.trashed", spam: "toast.spammed" } as const;

function ActionButton({ label, onClick, children }: { label: string; onClick(): void; children: ReactNode }) {
  return (
    <Tip label={label}>
      <motion.button
        type="button"
        className="g-button g-button-ghost g-button-icon"
        aria-label={label}
        onClick={onClick}
        whileTap={{ scale: 0.92 }}
      >
        {children}
      </motion.button>
    </Tip>
  );
}

type MailRoute = Extract<Route, { section: "mail" }>;

interface MailViewProps {
  route: MailRoute;
  mailbox: Mailbox | undefined;
  freshIds: ReadonlySet<string>;
  /** Keyboard shortcuts pause while a dialog or the composer has the focus. */
  shortcutsEnabled: boolean;
  navigate(route: Route, replace?: boolean): void;
  onReply(message: FullMessage): void;
}

export function MailView({ route, mailbox, freshIds, shortcutsEnabled, navigate, onReply }: MailViewProps) {
  const { t } = useI18n();
  const toast = useToast();
  const query = route.query ?? null;
  const folderQuery = useFolder(route.folder);
  const searchQuery = useSearch(query);
  // A search replaces the folder's list until it is cleared.
  const listQuery = query ? searchQuery : folderQuery;
  const messages = useMemo(() => listQuery.data?.pages.flatMap((page) => page.messages), [listQuery.data]);
  const message = useMessage(route.messageId);
  const remove = useDeleteMessage();
  const move = useMoveMessage();

  // Opening and closing messages keeps the search, if there is one.
  const open = useCallback(
    (folder: Folder, messageId: string | null, replace = false) =>
      navigate({ section: "mail", folder, messageId, ...(query ? { query } : {}) }, replace),
    [navigate, query],
  );
  const search = useCallback(
    (terms: string) => {
      const trimmed = terms.trim();
      navigate({ section: "mail", folder: "inbox", messageId: null, ...(trimmed ? { query: trimmed } : {}) });
    },
    [navigate],
  );
  const select = useCallback((id: string) => open(route.folder, id), [open, route.folder]);

  /** The message leaves the list: the selection moves to its neighbour, as after reading it. */
  const leave = useCallback(
    (id: string) => {
      const list = messages ?? [];
      const index = list.findIndex((item) => item.id === id);
      const next = list[index + 1] ?? list[index - 1];
      open(route.folder, next?.id ?? null, true);
    },
    [messages, open, route.folder],
  );

  const deleteMessage = useCallback(
    (id: string) => {
      remove.mutate(id, {
        onSuccess: () => toast(t("toast.deleted")),
        onError: () => toast(t("error.generic"), { kind: "error" }),
      });
      leave(id);
    },
    [leave, remove, t, toast],
  );

  /** Moves a message; with `sender`, Spam / Not spam also decide for the sender's future mail. */
  const moveMessage = useCallback(
    (target: FullMessage, box: MailBox | null, sender?: SenderVerdict) => {
      const previous = target.box ?? null;
      if (previous === box) return;
      const failed = () => toast(t("error.generic"), { kind: "error" });
      // Undo puts back both the folder and the sender rule the move replaced.
      const undo = (previousSender: SenderVerdict | null | undefined) =>
        move.mutate(
          { id: target.id, box: previous, sender: sender === undefined ? undefined : (previousSender ?? null) },
          { onSuccess: () => toast(t("toast.moveUndone"), { kind: "info", key: "move" }), onError: failed },
        );
      const done = sender === "block" ? "toast.reported" : sender === "allow" ? "toast.notSpam" : null;
      move.mutate(
        { id: target.id, box, sender },
        {
          onSuccess: (result) =>
            toast(t(done ?? (box ? MOVED_TOAST[box] : "toast.restored")), {
              key: "move",
              action: { label: t("toast.undo"), run: () => undo(result.previousSender) },
            }),
          onError: failed,
        },
      );
      leave(target.id);
    },
    [leave, move, t, toast],
  );

  const actions = useCallback(
    (target: FullMessage) => {
      const box = target.box ?? null;
      const natural = target.direction === "sent" ? "detail.moveToSent" : "detail.moveToInbox";
      const NaturalIcon = target.direction === "sent" ? IconSend : IconInbox;
      const received = target.direction === "received";
      return (
        <>
          {box === null && (
            <ActionButton label={`${t("detail.archive")} (E)`} onClick={() => moveMessage(target, "archive")}>
              <IconArchive size={16} stroke={1.5} />
            </ActionButton>
          )}
          {box === "archive" && (
            <ActionButton label={t(natural)} onClick={() => moveMessage(target, null)}>
              <NaturalIcon size={16} stroke={1.5} />
            </ActionButton>
          )}
          {received && (box === null || box === "archive") && (
            <ActionButton label={`${t("detail.reportSpam")} (!)`} onClick={() => moveMessage(target, "spam", "block")}>
              <IconAlertOctagon size={16} stroke={1.5} />
            </ActionButton>
          )}
          {box === "spam" && (
            <ActionButton label={t("detail.notSpam")} onClick={() => moveMessage(target, null, "allow")}>
              <IconMailCheck size={16} stroke={1.5} />
            </ActionButton>
          )}
          {box === "trash" ? (
            <ActionButton label={t("detail.restore")} onClick={() => moveMessage(target, null)}>
              <IconRestore size={16} stroke={1.5} />
            </ActionButton>
          ) : (
            <ActionButton label={`${t("detail.moveToTrash")} (#)`} onClick={() => moveMessage(target, "trash")}>
              <IconTrash size={16} stroke={1.5} />
            </ActionButton>
          )}
        </>
      );
    },
    [moveMessage, t],
  );

  // / searches, J/K move, R replies, E archives, ! reports spam, # moves to Trash, Escape goes back.
  useEffect(() => {
    if (!shortcutsEnabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) return;
      const list = messages ?? [];
      const index = list.findIndex((item) => item.id === route.messageId);
      const key = event.key.toLowerCase();
      if (key === "/") {
        document.getElementById(SEARCH_FIELD_ID)?.focus();
      } else if (key === "j" || key === "arrowdown") {
        const next = list[Math.min(index + 1, list.length - 1)];
        if (next) select(next.id);
      } else if (key === "k" || key === "arrowup") {
        const previous = list[Math.max(index - 1, 0)];
        if (previous) select(previous.id);
      } else if (key === "r" && message.data) {
        onReply(message.data);
      } else if (key === "e" && message.data && (message.data.box ?? null) === null) {
        moveMessage(message.data, "archive");
      } else if (
        event.key === "!" &&
        message.data?.direction === "received" &&
        (message.data.box ?? null) !== "spam" &&
        message.data.box !== "trash"
      ) {
        moveMessage(message.data, "spam", "block");
      } else if (event.key === "#" && message.data && message.data.box !== "trash") {
        moveMessage(message.data, "trash");
      } else if (key === "escape" && route.messageId) {
        open(route.folder, null);
      } else {
        return;
      }
      event.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [message.data, messages, moveMessage, onReply, open, route, select, shortcutsEnabled]);

  // Keep the selected row in view as J/K move through the list.
  useEffect(() => {
    if (route.messageId) {
      document
        .querySelector(`[data-message-id="${CSS.escape(route.messageId)}"]`)
        ?.scrollIntoView({ block: "nearest" });
    }
  }, [route.messageId]);

  return (
    <>
      <MessageList
        folder={route.folder}
        query={query}
        mailbox={mailbox}
        messages={messages}
        selectedId={route.messageId}
        freshIds={route.folder === "inbox" && !query ? freshIds : new Set()}
        hasMore={Boolean(listQuery.hasNextPage)}
        loadingMore={listQuery.isFetchingNextPage}
        onLoadMore={() => void listQuery.fetchNextPage()}
        onSelect={select}
        onSearch={search}
      />
      <MessageDetail
        message={message.data}
        loading={message.isLoading}
        selectedId={route.messageId}
        onReply={onReply}
        actions={actions}
        onDelete={route.folder === "trash" && !query ? deleteMessage : undefined}
        onBack={() => open(route.folder, null)}
      />
    </>
  );
}
