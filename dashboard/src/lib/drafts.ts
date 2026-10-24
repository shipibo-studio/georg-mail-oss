// Saved drafts: what the composer sends to be kept, and how a kept draft opens again.
import type { SavedDraft } from "../api/types";
import { uploadIds } from "./attachments";
import type { Draft } from "./reply";

export interface DraftInput {
  to: string[];
  cc: string[];
  subject: string;
  text: string;
  inReplyTo: string | null;
  attachments: string[];
}

/** Nothing written yet: such a draft is not worth keeping. */
export function isBlankDraft(draft: Draft): boolean {
  return (
    draft.to.length === 0 &&
    draft.cc.length === 0 &&
    !draft.subject.trim() &&
    !draft.text.trim() &&
    draft.files.length === 0
  );
}

/** What is saved: only files that finished uploading. */
export function draftInput(draft: Draft): DraftInput {
  return {
    to: draft.to,
    cc: draft.cc,
    subject: draft.subject,
    text: draft.text,
    inReplyTo: draft.inReplyTo,
    attachments: uploadIds(draft.files.filter((file) => file.status === "ready")),
  };
}

/** A kept draft back in the composer, its files already uploaded. */
export function fromSavedDraft(saved: SavedDraft): Draft {
  return {
    to: saved.to,
    cc: saved.cc,
    subject: saved.subject,
    text: saved.text,
    inReplyTo: saved.inReplyTo,
    files: saved.attachments.map((file) => ({
      key: file.id,
      name: file.filename,
      sizeBytes: file.sizeBytes,
      uploadId: file.id,
      status: "ready" as const,
      error: null,
    })),
  };
}
