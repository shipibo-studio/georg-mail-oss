// The dashboard shell: navigation, the composer, settings and the ⌘K palette around one section
// (mail, notifications or one of the edition's workspace sections) at a time. The URL is the state.
import { IconAlertTriangle, IconWifiOff } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, SessionExpiredError } from "../api/client";
import { keys, useFolder, useMailbox, useUpdateStatus } from "../api/queries";
import type { FullMessage, MessageSummary, SavedDraft } from "../api/types";
import { WORKSPACE_DESTINATIONS, WorkspaceSection } from "../editions/workspace";
import { useI18n } from "../i18n/I18nProvider";
import { fromSavedDraft } from "../lib/drafts";
import { formatFullDate } from "../lib/format";
import { EMPTY_DRAFT, replyDraft } from "../lib/reply";
import { hasSelection, parseRoute, type Route, routePath } from "../lib/route";
import { CommandPalette } from "./CommandPalette";
import { Composer, type ComposerState, newComposerState } from "./Composer";
import { DraftsView } from "./DraftsView";
import { ImportDialog } from "./ImportDialog";
import { isPaletteShortcut, isTyping } from "./keyboard";
import { MailView } from "./MailView";
import { MobileNav } from "./MobileNav";
import { NotificationsView } from "./NotificationsView";
import { PreferenceSync } from "./PreferenceSync";
import { SettingsDialog } from "./SettingsDialog";
import { SetupGate } from "./SetupView";
import { Sidebar } from "./Sidebar";
import { useToast } from "./Toasts";
import { UpdateDialog } from "./UpdateDialog";

const FRESH_HIGHLIGHT_MS = 2200;

function useRoute(): [Route, (route: Route, replace?: boolean) => void] {
  const [route, setRoute] = useState(() => parseRoute(location.pathname, location.hash));
  useEffect(() => {
    const onPop = () => setRoute(parseRoute(location.pathname, location.hash));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const navigate = useCallback((next: Route, replace = false) => {
    const path = routePath(next);
    if (path !== location.pathname + location.hash) history[replace ? "replaceState" : "pushState"](null, "", path);
    setRoute(next);
  }, []);
  return [route, navigate];
}

/** A route this edition has no section for (a workspace link in the mail client) opens the inbox. */
function isKnownRoute(route: Route): boolean {
  return (
    route.section === "mail" ||
    route.section === "notifications" ||
    WORKSPACE_DESTINATIONS.some((destination) => destination.active(route))
  );
}

function useOnline(): boolean {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return online;
}

/** Messages that arrived after the first load: they slide in, glow briefly, and get a toast. */
function useFreshMessages(messages: MessageSummary[] | undefined, onArrival: (fresh: MessageSummary[]) => void) {
  const known = useRef<Set<string> | null>(null);
  const [freshIds, setFreshIds] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    if (!messages) return;
    if (known.current === null) {
      known.current = new Set(messages.map((message) => message.id));
      return;
    }
    const seen = known.current;
    const arrived = messages.filter((message) => !seen.has(message.id));
    for (const message of messages) seen.add(message.id);
    if (arrived.length === 0) return;
    setFreshIds(new Set(arrived.map((message) => message.id)));
    onArrival(arrived);
    const timer = setTimeout(() => setFreshIds(new Set()), FRESH_HIGHLIGHT_MS);
    return () => clearTimeout(timer);
  }, [messages, onArrival]);
  return freshIds;
}

export function App() {
  const { t, locale, clock } = useI18n();
  const toast = useToast();
  const client = useQueryClient();
  const online = useOnline();
  const [route, navigate] = useRoute();
  useEffect(() => {
    if (!isKnownRoute(route)) navigate({ section: "mail", folder: "inbox", messageId: null }, true);
  }, [route, navigate]);
  const [composer, setComposer] = useState<ComposerState | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  // A new dialog for every opening: reopening during the close animation would otherwise bring the
  // finished import back instead of a fresh one.
  const [importRun, setImportRun] = useState(0);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [updateOpen, setUpdateOpen] = useState(false);
  const updates = useUpdateStatus();

  // The inbox is watched from every section, so new mail is announced wherever the owner is.
  const mailbox = useMailbox();
  const inbox = useFolder("inbox");
  const inboxMessages = useMemo(() => inbox.data?.pages.flatMap((page) => page.messages), [inbox.data]);

  // Access ended the session: reloading sends the browser through the sign-in page.
  const sessionExpired = [mailbox.error, inbox.error].some((error) => error instanceof SessionExpiredError);
  useEffect(() => {
    if (!sessionExpired) return;
    toast(t("error.session"), { kind: "info" });
    const timer = setTimeout(() => location.reload(), 1200);
    return () => clearTimeout(timer);
  }, [sessionExpired, t, toast]);

  const onArrival = useCallback(
    (arrived: MessageSummary[]) => {
      const first = arrived[0];
      const sender = first?.from.name || first?.from.address || "";
      toast(arrived.length === 1 ? t("toast.newMail", { sender }) : t("toast.newMailMany", { count: arrived.length }), {
        kind: "info",
        key: "new-mail",
      });
      client.invalidateQueries({ queryKey: keys.mailbox });
    },
    [client, t, toast],
  );
  const freshIds = useFreshMessages(inboxMessages, onArrival);

  // The tab title shows the unread count, like any mail client.
  const unread = mailbox.data?.unread ?? 0;
  useEffect(() => {
    document.title = unread > 0 ? `(${unread}) ${t("app.name")}` : t("app.name");
  }, [unread, t]);

  const compose = useCallback(() => {
    setComposer((current) => current ?? newComposerState(EMPTY_DRAFT));
    setComposerOpen(true);
  }, []);
  // A kept draft opens in the composer, replacing whatever was there (that one is already saved).
  const openDraft = useCallback((saved: SavedDraft) => {
    setComposer(newComposerState(fromSavedDraft(saved), saved.id));
    setComposerOpen(true);
  }, []);
  const reply = useCallback(
    (original: FullMessage) => {
      const sender = original.from.name || original.from.address || "";
      const header = t("compose.quoteHeader", { date: formatFullDate(original.receivedAt, locale, clock), sender });
      setComposer(newComposerState(replyDraft(original, header, mailbox.data?.aliases ?? [])));
      setComposerOpen(true);
    },
    [clock, locale, mailbox.data?.aliases, t],
  );
  const closeComposer = useCallback(() => setComposerOpen(false), []);
  const discardComposer = useCallback(() => {
    setComposerOpen(false);
    setComposer(null);
  }, []);
  const openSettings = useCallback(() => setSettingsOpen(true), []);
  const openImport = useCallback(() => {
    setSettingsOpen(false);
    setImportRun((run) => run + 1);
    setImportOpen(true);
  }, []);

  // With a repository to commit to, the update is reviewed right away; without one, Settings says how.
  const canUpdateHere = Boolean(updates.data?.repository);
  const openUpdate = useCallback(() => {
    setSettingsOpen(!canUpdateHere);
    setUpdateOpen(canUpdateHere);
  }, [canUpdateHere]);

  const overlayOpen = settingsOpen || importOpen || paletteOpen || composerOpen || updateOpen;
  // ⌘K opens the palette anywhere; C composes when nothing else has the keyboard.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isPaletteShortcut(event)) {
        event.preventDefault();
        setPaletteOpen((open) => !open);
        return;
      }
      if (overlayOpen || event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) return;
      if (event.key.toLowerCase() === "c") {
        event.preventDefault();
        compose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [compose, overlayOpen]);

  if (mailbox.isError && !sessionExpired) {
    const failure = (
      <div className="fatal">
        <IconAlertTriangle size={24} stroke={1.5} />
        <p>{t("error.mailbox")}</p>
        <button type="button" className="btn" onClick={() => mailbox.refetch()}>
          {t("error.retry")}
        </button>
      </div>
    );
    // Signed in but not a member: a fresh self-hosted install may be waiting for its owner.
    const notMember = mailbox.error instanceof ApiError && mailbox.error.status === 403;
    return notMember ? <SetupGate fallback={failure} onDone={() => client.invalidateQueries()} /> : failure;
  }

  return (
    <div className={`app section-${route.section} ${hasSelection(route) ? "has-selection" : ""}`}>
      <Sidebar
        mailbox={mailbox.data}
        route={route}
        navigate={navigate}
        onCompose={compose}
        onSettings={openSettings}
        onSearch={() => setPaletteOpen(true)}
        onUpdate={openUpdate}
      />
      {route.section === "mail" && route.folder === "drafts" && !route.query && <DraftsView onOpen={openDraft} />}
      {route.section === "mail" && (route.folder !== "drafts" || route.query) && (
        <MailView
          route={route}
          mailbox={mailbox.data}
          freshIds={freshIds}
          shortcutsEnabled={!overlayOpen}
          navigate={navigate}
          onReply={reply}
        />
      )}
      <WorkspaceSection route={route} navigate={navigate} />
      {route.section === "notifications" && <NotificationsView />}
      <MobileNav route={route} unread={unread} navigate={navigate} onCompose={compose} onSettings={openSettings} />
      <PreferenceSync saved={mailbox.data?.preferences} />

      <AnimatePresence>
        {composer && composerOpen && (
          <Composer
            key={composer.idempotencyKey}
            state={composer}
            mailbox={mailbox.data}
            onChange={(update) => setComposer((current) => (current ? update(current) : current))}
            onClose={closeComposer}
            onDiscard={discardComposer}
            onSent={() => {
              discardComposer();
              client.invalidateQueries({ queryKey: keys.folder("sent") });
            }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {composer && !composerOpen && (
          <motion.button
            type="button"
            className="draft-pill"
            onClick={() => setComposerOpen(true)}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            transition={{ type: "spring", stiffness: 420, damping: 30 }}
          >
            {composer.draft.subject || t(composer.draft.inReplyTo ? "compose.reply" : "compose.newMessage")}
          </motion.button>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {settingsOpen && mailbox.data && (
          <SettingsDialog
            mailbox={mailbox.data}
            onClose={() => setSettingsOpen(false)}
            onImport={openImport}
            onUpdate={openUpdate}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {importOpen && <ImportDialog key={importRun} onClose={() => setImportOpen(false)} />}
      </AnimatePresence>

      <AnimatePresence>
        {updateOpen && updates.data?.latest && (
          <UpdateDialog version={updates.data.latest.version} onClose={() => setUpdateOpen(false)} />
        )}
      </AnimatePresence>

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        navigate={navigate}
        onCompose={compose}
        onSettings={openSettings}
        onImport={openImport}
      />

      <AnimatePresence>
        {!online && (
          <motion.div
            className="offline"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
          >
            <IconWifiOff size={14} stroke={1.5} /> {t("error.offline")}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
