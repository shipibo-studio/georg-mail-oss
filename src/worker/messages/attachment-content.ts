// The bytes of one attachment, cut from the stored original message. Attachments are not stored
// separately: the original (.eml) in R2 is the single copy, and an attachment is found again by its
// file name, content type and size, plus its position among identical ones.
import type { Attachment } from "../db/schema";
import { extractAttachment } from "../email/parse-email";

export async function attachmentBytes(
  original: ArrayBuffer,
  rows: Attachment[],
  row: Attachment,
): Promise<Uint8Array | null> {
  const sameKind = rows.filter(
    (attachment) =>
      attachment.filename === row.filename &&
      attachment.contentType === row.contentType &&
      attachment.sizeBytes === row.sizeBytes,
  );
  return extractAttachment(original, {
    filename: row.filename,
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
    ordinal: sameKind.indexOf(row),
  });
}
