// The dashboard's only way to reach the API. Writes carry the X-Georg-Dashboard header (and the
// browser adds Origin), which the Worker requires against cross-site requests.
import type { DraftInput } from "../lib/drafts";
import type { Folder } from "../lib/route";
import type {
  FullMessage,
  ImportFolder,
  ImportResult,
  MailBox,
  Mailbox,
  MessagePage,
  SavedDraft,
  SenderVerdict,
  SendRequest,
  SendResult,
  SetupRequest,
  SetupStatus,
  UploadedFile,
} from "./types";

const MAILBOX_API = "/dashboard/api/mailbox";
/** The REST API's resources, reached by the signed-in owner (see owner-identity.ts). */
export const V1_API = "/dashboard/api/v1";
/** Only the self-hosted mail client answers it; the hosted product has no first run. */
const SETUP_API = "/dashboard/api/setup";
const DASHBOARD_HEADER = "X-Georg-Dashboard";
const FILENAME_HEADER = "X-Filename";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor(message: string, status: number, code: string | null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

/** Cloudflare Access ended the session: the page must reload to sign in again. */
export class SessionExpiredError extends Error {
  constructor() {
    super("The dashboard session expired.");
    this.name = "SessionExpiredError";
  }
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  /** Sent as the raw request body instead of JSON (file uploads, imported messages). */
  file?: File;
  raw?: { bytes: Uint8Array; contentType: string };
  headers?: Record<string, string>;
}

/** A request to the dashboard's API: path under /dashboard/api, CSRF header on writes. */
export async function apiRequest<T>(url: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? "GET";
  const headers = new Headers(options.headers);
  headers.set("Accept", "application/json");
  if (method !== "GET") headers.set(DASHBOARD_HEADER, "1");
  if (options.body !== undefined) headers.set("Content-Type", "application/json");
  if (options.file) {
    headers.set("Content-Type", options.file.type || "application/octet-stream");
    // Header values are ASCII: the Worker decodes the name.
    headers.set(FILENAME_HEADER, encodeURIComponent(options.file.name));
  }

  if (options.raw) headers.set("Content-Type", options.raw.contentType);

  const response = await fetch(url, {
    method,
    headers,
    body:
      options.file ??
      (options.raw ? new Blob([options.raw.bytes.slice()]) : undefined) ??
      (options.body === undefined ? undefined : JSON.stringify(options.body)),
    credentials: "same-origin",
    // Access answers an expired session with a redirect to its login page.
    redirect: "manual",
  });
  if (response.type === "opaqueredirect" || response.status === 401) throw new SessionExpiredError();
  if (response.status === 204) return undefined as T;
  const data = (await response.json().catch(() => null)) as
    | (T & { error?: { message?: string; code?: string } })
    | null;
  if (!response.ok) {
    throw new ApiError(data?.error?.message ?? response.statusText, response.status, data?.error?.code ?? null);
  }
  return data as T;
}

const request = <T>(path: string, options?: RequestOptions) => apiRequest<T>(`${MAILBOX_API}${path}`, options);

/** Plain links: the browser downloads them with the Access session cookie, as files. */
export const downloads = {
  original: (messageId: string) => `${MAILBOX_API}/messages/${encodeURIComponent(messageId)}/original`,
  attachment: (messageId: string, attachmentId: string) =>
    `${MAILBOX_API}/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`,
};

export const api = {
  mailbox: () => request<Mailbox>(""),
  updateSettings: (settings: Pick<Mailbox, "forwardEnabled">) =>
    request<Mailbox>("", { method: "PATCH", body: settings }),
  messages: (folder: Folder, cursor: string | null) => {
    const query = new URLSearchParams({ folder, limit: "40" });
    if (cursor) query.set("cursor", cursor);
    return request<MessagePage>(`/messages?${query}`);
  },
  /** POST keeps the terms out of URLs and logs; the Worker changes nothing. */
  search: (q: string, cursor: string | null) =>
    request<MessagePage>("/messages/search", {
      method: "POST",
      body: cursor ? { q, limit: 40, cursor } : { q, limit: 40 },
    }),
  message: (id: string) => request<FullMessage>(`/messages/${encodeURIComponent(id)}`),
  send: (message: SendRequest, idempotencyKey: string) =>
    request<SendResult>("/messages", { method: "POST", body: message, headers: { "Idempotency-Key": idempotencyKey } }),
  /** With `sender`, also blocks or allows the sender's future mail (null forgets them). */
  move: (id: string, box: MailBox | null, sender?: SenderVerdict | null) =>
    request<{ id: string; box: MailBox | null; previousSender?: SenderVerdict | null }>(
      `/messages/${encodeURIComponent(id)}`,
      { method: "PATCH", body: sender === undefined ? { box } : { box, sender } },
    ),
  remove: (id: string) => request<void>(`/messages/${encodeURIComponent(id)}`, { method: "DELETE" }),
  drafts: () => request<{ drafts: SavedDraft[] }>("/drafts").then((body) => body.drafts),
  createDraft: (input: DraftInput) => request<SavedDraft>("/drafts", { method: "POST", body: input }),
  updateDraft: (id: string, input: DraftInput) =>
    request<SavedDraft>(`/drafts/${encodeURIComponent(id)}`, { method: "PUT", body: input }),
  deleteDraft: (id: string) => request<void>(`/drafts/${encodeURIComponent(id)}`, { method: "DELETE" }),
  upload: (file: File) => request<UploadedFile>("/uploads", { method: "POST", file }),
  /** One message of an import, as it was exported. */
  importMessage: (bytes: Uint8Array, folder: ImportFolder) =>
    request<ImportResult>("/imports", {
      method: "POST",
      raw: { bytes, contentType: "message/rfc822" },
      headers: { "X-Import-Folder": folder },
    }),
  removeUpload: (id: string) => request<void>(`/uploads/${encodeURIComponent(id)}`, { method: "DELETE" }),
};

export const setupApi = {
  status: () => apiRequest<SetupStatus>(SETUP_API),
  complete: (setup: SetupRequest) =>
    apiRequest<{ address: string; owner: string }>(SETUP_API, { method: "POST", body: setup }),
};
