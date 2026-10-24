// Files the owner attaches in the composer. Each one is uploaded on its own request and kept in R2 as
// it came, without parsing, so no request does more than copy bytes; sending reads them back.
import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { PERSONAL_UPLOAD_TTL_MS } from "../config";
import { createDatabase, type Database } from "../db/client";
import { type Inbox, mailUploads } from "../db/schema";
import { createId } from "../ids";
import { personalFileKey } from "../storage/raw-messages";

export type MailUpload = typeof mailUploads.$inferSelect;

/** Where the composer uploads files; the only dashboard route whose body is larger than JSON. */
export const PERSONAL_UPLOAD_PATH = "/dashboard/api/mailbox/uploads";
/** The file name travels percent-encoded in this header, since header values are ASCII. */
export const FILENAME_HEADER = "X-Filename";
const MAX_FILENAME_CHARS = 200;
const FALLBACK_FILENAME = "attachment";
const FALLBACK_CONTENT_TYPE = "application/octet-stream";
/** Uploads the cron deletes per run; the rest go in later runs. */
const STALE_UPLOAD_BATCH = 100;
// Control and invisible formatting characters: a right-to-left override can make "fdp.exe" read
// as "exe.pdf". Path separators would let a name pretend to be a folder.
const UNSAFE_FILENAME_CHARACTERS = /[\p{Cc}\p{Cf}\\/]/gu;
const MEDIA_TYPE = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/;
// Types that mail services refuse or quarantine (Gmail's list): sending them would only bounce or
// hurt the domain's reputation.
const BLOCKED_EXTENSIONS =
  /\.(?:ade|adp|apk|appx|appxbundle|bat|cab|chm|cmd|com|cpl|dll|dmg|exe|hta|ins|isp|iso|jar|js|jse|lib|lnk|mde|msc|msi|msix|msixbundle|msp|mst|nsh|pif|ps1|scr|sct|shb|sys|vb|vbe|vbs|vxd|wsc|wsf|wsh)$/i;

/** A name safe to show and to put in a MIME header: one line, no invisible tricks, no folders. */
export function cleanFilename(raw: string): string {
  const cleaned = raw.normalize("NFC").replace(UNSAFE_FILENAME_CHARACTERS, "_").trim();
  return cleaned.slice(0, MAX_FILENAME_CHARS) || FALLBACK_FILENAME;
}

/** The declared media type without parameters, or a neutral one when it is not a valid type. */
export function cleanContentType(raw: string | undefined): string {
  const type = raw?.split(";")[0]?.trim().toLowerCase() ?? "";
  return MEDIA_TYPE.test(type) ? type : FALLBACK_CONTENT_TYPE;
}

export function isBlockedFile(filename: string): boolean {
  return BLOCKED_EXTENSIONS.test(filename);
}

/** Native base64 (V8): about a millisecond per 5 MB, where a JavaScript loop would take tens. */
export function toBase64(bytes: Uint8Array): string {
  return (bytes as Uint8Array & { toBase64(): string }).toBase64();
}

export async function pendingUploads(db: Database, mailbox: Pick<Inbox, "id">): Promise<MailUpload[]> {
  return db.select().from(mailUploads).where(eq(mailUploads.inboxId, mailbox.id));
}

export async function storeUpload(
  env: { MAIL_STORAGE: R2Bucket },
  db: Database,
  mailbox: Pick<Inbox, "id" | "accountId">,
  file: { filename: string; contentType: string; bytes: ArrayBuffer },
): Promise<MailUpload> {
  const id = createId("upl");
  const objectKey = personalFileKey(mailbox.accountId, mailbox.id, id);
  await env.MAIL_STORAGE.put(objectKey, file.bytes, { httpMetadata: { contentType: file.contentType } });
  const upload: MailUpload = {
    id,
    inboxId: mailbox.id,
    objectKey,
    filename: file.filename,
    contentType: file.contentType,
    sizeBytes: file.bytes.byteLength,
    createdAt: Date.now(),
  };
  await db.insert(mailUploads).values(upload);
  return upload;
}

/** The mailbox's uploads with these ids, in the order given; null when any of them is missing. */
export async function findUploads(
  db: Database,
  mailbox: Pick<Inbox, "id">,
  ids: string[],
): Promise<MailUpload[] | null> {
  if (ids.length === 0) return [];
  const rows = await db
    .select()
    .from(mailUploads)
    .where(and(eq(mailUploads.inboxId, mailbox.id), inArray(mailUploads.id, ids)));
  const byId = new Map(rows.map((row) => [row.id, row]));
  const ordered = ids.map((id) => byId.get(id));
  return ordered.every((row) => row !== undefined) ? (ordered as MailUpload[]) : null;
}

export async function deleteUploads(env: { MAIL_STORAGE: R2Bucket }, db: Database, uploads: MailUpload[]) {
  if (uploads.length === 0) return;
  await env.MAIL_STORAGE.delete(uploads.map((upload) => upload.objectKey));
  await db.delete(mailUploads).where(
    inArray(
      mailUploads.id,
      uploads.map((upload) => upload.id),
    ),
  );
}

/** The cron's share: files uploaded but never sent. */
export async function purgeStaleUploads(env: Pick<Env, "DB" | "MAIL_STORAGE">, now = Date.now()): Promise<number> {
  const db = createDatabase(env.DB);
  const stale = await db
    .select()
    .from(mailUploads)
    .where(
      and(
        lt(mailUploads.createdAt, now - PERSONAL_UPLOAD_TTL_MS),
        // A draft that still holds a file keeps it, however old.
        sql`${mailUploads.id} NOT IN (SELECT json_each.value FROM mail_drafts, json_each(mail_drafts.attachments))`,
      ),
    )
    .limit(STALE_UPLOAD_BATCH);
  await deleteUploads(env, db, stale);
  return stale.length;
}
