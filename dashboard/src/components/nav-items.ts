import {
  IconAlertOctagon,
  IconArchive,
  IconBell,
  IconFilePencil,
  IconInbox,
  IconSend,
  IconTrash,
} from "@tabler/icons-react";
import type { MessageKey } from "../i18n/translate";
import type { Folder, Route } from "../lib/route";

/** A place in the dashboard, as the sidebar, the phone's tabs and ⌘K show it. */
export interface NavItem {
  id: string;
  label: MessageKey;
  Icon: typeof IconInbox;
  route: Route;
  active(route: Route): boolean;
}

const folderItem = (folder: Folder, label: MessageKey, Icon: typeof IconInbox): NavItem => ({
  id: folder,
  label,
  Icon,
  route: { section: "mail", folder, messageId: null },
  // While searching, no folder is the one in view.
  active: (route) => route.section === "mail" && !route.query && route.folder === folder,
});

export const MAIL_ITEMS: NavItem[] = [
  folderItem("inbox", "nav.inbox", IconInbox),
  folderItem("sent", "nav.sent", IconSend),
  folderItem("drafts", "nav.drafts", IconFilePencil),
  folderItem("archive", "nav.archive", IconArchive),
  folderItem("spam", "nav.spam", IconAlertOctagon),
  folderItem("trash", "nav.trash", IconTrash),
];

export const ACCOUNT_ITEMS: NavItem[] = [
  {
    id: "notifications",
    label: "nav.notifications",
    Icon: IconBell,
    route: { section: "notifications" },
    active: (route) => route.section === "notifications",
  },
];
