// The dashboard's URL is its state. Older Slack notifications link to /dashboard/mailbox/{messageId},
// which opens the message in the inbox.
//   /dashboard/{inbox|sent|drafts|archive|spam|trash}/{messageId?}  personal mail (drafts open in the composer)
//   /dashboard/search/{messageId?}#q={terms}                     search of personal mail; the terms
//                                                                stay in the fragment, never sent to the server
//   /dashboard/projects/{projectId?}/{inboxId?}/{messageId?}     projects and their test inboxes
//   /dashboard/keys/{keyId|new?}                                 API keys
//   /dashboard/mcp                                               connecting an agent over MCP
//   /dashboard/ai                                                the AI that helps extraction (none by default)
//   /dashboard/webhooks/{webhookId|new?}                         webhooks and their deliveries
//   /dashboard/notify/{hookId|new?}                              notify hooks and their notices
//   /dashboard/activity                                          audit trail
//   /dashboard/notifications                                     the account's notification channels
export const FOLDERS = ["inbox", "sent", "drafts", "archive", "spam", "trash"] as const;
export type Folder = (typeof FOLDERS)[number];
export type Section =
  | "mail"
  | "projects"
  | "keys"
  | "mcp"
  | "ai"
  | "webhooks"
  | "notify"
  | "activity"
  | "notifications";

export type Route =
  | { section: "mail"; folder: Folder; messageId: string | null; query?: string }
  | { section: "projects"; projectId: string | null; inboxId: string | null; messageId: string | null }
  | { section: "keys"; keyId: string | null }
  | { section: "mcp" }
  | { section: "ai" }
  | { section: "notifications" }
  | { section: "webhooks"; webhookId: string | null }
  | { section: "notify"; hookId: string | null }
  | { section: "activity" };

const BASE = "/dashboard";
/** The key and webhook forms' route: not an id, so it can never collide with one. */
export const NEW_KEY = "new";
/** The Worker refuses longer searches. */
export const MAX_QUERY_LENGTH = 200;

function queryOf(hash: string): string | null {
  const query = new URLSearchParams(hash.replace(/^#/, "")).get("q")?.trim().slice(0, MAX_QUERY_LENGTH);
  return query || null;
}

const idOf = (prefix: string, candidate: string | undefined): string | null =>
  candidate && new RegExp(`^${prefix}_[a-z0-9]{1,40}$`).test(candidate) ? candidate : null;

export function parseRoute(pathname: string, hash = ""): Route {
  const [first, second, third, fourth] = pathname
    .replace(new RegExp(`^${BASE}/?`), "")
    .split("/")
    .filter(Boolean);
  if (first === "projects") {
    const projectId = idOf("prj", second);
    const inboxId = projectId ? idOf("inb", third) : null;
    return { section: "projects", projectId, inboxId, messageId: inboxId ? idOf("msg", fourth) : null };
  }
  if (first === "keys") return { section: "keys", keyId: second === NEW_KEY ? NEW_KEY : idOf("key", second) };
  if (first === "webhooks")
    return { section: "webhooks", webhookId: second === NEW_KEY ? NEW_KEY : idOf("whk", second) };
  if (first === "notify") return { section: "notify", hookId: second === NEW_KEY ? NEW_KEY : idOf("nhk", second) };
  if (first === "activity") return { section: "activity" };
  if (first === "mcp") return { section: "mcp" };
  if (first === "ai") return { section: "ai" };
  if (first === "notifications") return { section: "notifications" };
  const query = first === "search" ? queryOf(hash) : null;
  if (query) return { section: "mail", folder: "inbox", messageId: idOf("msg", second), query };
  const folder = FOLDERS.find((name) => name === first) ?? "inbox";
  const candidate = folder === first || first === "mailbox" ? second : undefined;
  return { section: "mail", folder, messageId: idOf("msg", candidate) };
}

export function routePath(route: Route): string {
  switch (route.section) {
    case "mail": {
      const place = route.query ? "search" : route.folder;
      const path = route.messageId ? `${BASE}/${place}/${route.messageId}` : `${BASE}/${place}`;
      return route.query ? `${path}#${new URLSearchParams({ q: route.query })}` : path;
    }
    case "projects":
      return [BASE, "projects", route.projectId, route.projectId && route.inboxId, route.inboxId && route.messageId]
        .filter(Boolean)
        .join("/");
    case "keys":
      return route.keyId ? `${BASE}/keys/${route.keyId}` : `${BASE}/keys`;
    case "webhooks":
      return route.webhookId ? `${BASE}/webhooks/${route.webhookId}` : `${BASE}/webhooks`;
    case "notify":
      return route.hookId ? `${BASE}/notify/${route.hookId}` : `${BASE}/notify`;
    case "activity":
      return `${BASE}/activity`;
    case "mcp":
      return `${BASE}/mcp`;
    case "ai":
      return `${BASE}/ai`;
    case "notifications":
      return `${BASE}/notifications`;
  }
}

/** On phones the list and the detail take turns: true when the detail is the one showing. */
export function hasSelection(route: Route): boolean {
  switch (route.section) {
    case "mail":
      return route.messageId !== null;
    case "projects":
      return route.inboxId !== null;
    case "keys":
      return route.keyId !== null;
    case "webhooks":
      return route.webhookId !== null;
    case "notify":
      return route.hookId !== null;
    case "activity":
    case "mcp":
    case "ai":
    case "notifications":
      return false;
  }
}
