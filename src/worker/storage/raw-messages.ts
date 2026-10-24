// Raw messages live under <root>/<accountId>/<inboxId>/<messageId>.eml, so deleting an inbox or a
// whole account is a prefix delete. Every path segment is a server-generated id, never user input.
// Disposable inboxes use raw/, which a bucket lifecycle rule also expires after 31 days as a safety
// net. Personal mail is the owner's real mail and must outlive that rule, so it uses personal/.

const R2_DELETE_BATCH_SIZE = 1_000;
export const RAW_ROOT_PREFIX = "raw/";
export const PERSONAL_ROOT_PREFIX = "personal/";
export const STORAGE_ROOTS = [RAW_ROOT_PREFIX, PERSONAL_ROOT_PREFIX] as const;
export type StorageRoot = (typeof STORAGE_ROOTS)[number];

export function rawMessageKey(
  accountId: string,
  inboxId: string,
  messageId: string,
  root: StorageRoot = RAW_ROOT_PREFIX,
): string {
  return `${root}${accountId}/${inboxId}/${messageId}.eml`;
}

/** A file the owner uploaded to send, kept under the mailbox so deleting the mailbox removes it. */
export function personalFileKey(accountId: string, inboxId: string, uploadId: string): string {
  return `${PERSONAL_ROOT_PREFIX}${accountId}/${inboxId}/files/${uploadId}`;
}

export function accountPrefix(accountId: string): string {
  return `${RAW_ROOT_PREFIX}${accountId}/`;
}

export function inboxPrefix(accountId: string, inboxId: string): string {
  return `${accountPrefix(accountId)}${inboxId}/`;
}

/** Deletes every object under the prefix, a page at a time. */
export async function deleteObjectsWithPrefix(bucket: R2Bucket, prefix: string): Promise<void> {
  let cursor: string | undefined;
  do {
    const listing = await bucket.list({ prefix, cursor, limit: R2_DELETE_BATCH_SIZE });
    const keys = listing.objects.map((object) => object.key);
    if (keys.length > 0) await bucket.delete(keys);
    cursor = listing.truncated ? listing.cursor : undefined;
  } while (cursor);
}

export async function deleteInboxObjects(bucket: R2Bucket, accountId: string, inboxId: string): Promise<void> {
  await deleteObjectsWithPrefix(bucket, inboxPrefix(accountId, inboxId));
}
