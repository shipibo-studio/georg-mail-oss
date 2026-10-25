// The dashboard's only way to reach the API. Writes carry the X-Georg-Dashboard header (and the
// browser adds Origin), which the Worker requires against cross-site requests.
import type { DraftInput } from "../lib/drafts";
import type { Preferences } from "../lib/preferences";
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
  UpdateCommit,
  UpdatePlan,
  UpdateStatus,
  UploadedFile,
} from "./types";

const MAILBOX_API = "/dashboard/api/mailbox";
/** The REST API's resources, reached by the signed-in owner (see owner-identity.ts). */
export const V1_API = "/dashboard/api/v1";
/** Only the self-hosted mail client answers it; the hosted product has no first run. */
const SETUP_API = "/dashboard/api/setup";
/** Only the self-hosted mail client answers it; the hosted product is deployed by its operator. */
const UPDATES_API = "/dashboard/api/updates";
const DASHBOARD_HEADER = "X-Georg-Dashboard";
const FILENAME_HEADER = "X-Filename";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string | null;
  /** From a 429's Retry-After: how long to wait before trying again. */
  readonly retryAfterMs: number | null;

  constructor(message: string, status: number, code: string | null, retryAfterMs: number | null = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.retryAfterMs = retryAfterMs;
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

/** Retry-After in seconds (the only form the Worker sends), as milliseconds; null when absent. */
export function retryAfterMs(header: string | null): number | null {
  const seconds = Number(header);
  return header !== null && header.trim() !== "" && Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : null;
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
    throw new ApiError(
      data?.error?.message ?? response.statusText,
      response.status,
      data?.error?.code ?? null,
      retryAfterMs(response.headers.get("Retry-After")),
    );
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
  savePreferences: (changes: Preferences) => request<Preferences>("/preferences", { method: "PUT", body: changes }),
  addAlias: (address: string) => request<{ address: string }>("/aliases", { method: "POST", body: { address } }),
  removeAlias: (address: string) => request<void>(`/aliases/${encodeURIComponent(address)}`, { method: "DELETE" }),
  messages: (folder: Folder, cursor: string | null) => {
    const query = new URLSearchParams({ folder, limit: "40" });
    if (cursor) query.set("cursor", cursor);
    return request<MessagePage>(`/messages?${query}`);
  },
  /** POST keeps the terms out of URLs and logs; the Worker changes nothing. */
  search: (q: string, cursor: string | null) =>
    request<MessagePage>("/messages/search", {
      method: "POST",
      // The offset lets after: and before: mean days where the owner is.
      body: { q, limit: 40, timezoneOffset: new Date().getTimezoneOffset(), ...(cursor ? { cursor } : {}) },
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

export const updatesApi = {
  /** Null where updates do not exist (the hosted product answers 404). */
  status: () =>
    apiRequest<UpdateStatus>(UPDATES_API).catch((error: unknown) => {
      if (error instanceof ApiError && error.status === 404) return null;
      throw error;
    }),
  /** Asks GitHub now instead of within six hours (the Worker allows one look a minute). */
  check: () => apiRequest<UpdateStatus>(`${UPDATES_API}/check`, { method: "POST", body: {} }),
  plan: (version: string) => apiRequest<UpdatePlan>(`${UPDATES_API}/plan`, { method: "POST", body: { version } }),
  stage: (version: string, paths: string[]) =>
    apiRequest<{ staged: number }>(`${UPDATES_API}/stage`, { method: "POST", body: { version, paths } }),
  apply: (version: string, head: string) =>
    apiRequest<UpdateCommit>(`${UPDATES_API}/apply`, { method: "POST", body: { version, head } }),
};
