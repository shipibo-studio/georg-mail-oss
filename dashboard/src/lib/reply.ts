import type { FullMessage } from "../api/types";
import type { DraftFile } from "./attachments";

const REPLY_PREFIX = /^\s*(?:re|aw|sv|res)\s*:/i;
const MAX_QUOTED_LINES = 60;

export interface Draft {
  to: string[];
  cc: string[];
  subject: string;
  text: string;
  inReplyTo: string | null;
  files: DraftFile[];
}

export const EMPTY_DRAFT: Draft = { to: [], cc: [], subject: "", text: "", inReplyTo: null, files: [] };

export function replySubject(subject: string | null): string {
  const base = (subject ?? "").trim();
  return REPLY_PREFIX.test(base) ? base : `Re: ${base}`.trim();
}

/** Quotes the original below an empty line for the reply, like every mail client does. */
export function quoteText(text: string | null, header: string): string {
  const lines = (text ?? "").replace(/\r\n/g, "\n").trimEnd().split("\n").slice(0, MAX_QUOTED_LINES);
  return `\n\n${header}\n${lines.map((line) => `> ${line}`).join("\n")}`;
}

export function replyDraft(message: FullMessage, quoteHeader: string): Draft {
  const to = message.direction === "sent" ? (message.recipients ?? []) : [message.from.address ?? ""];
  return {
    to: to.filter(Boolean),
    cc: [],
    subject: replySubject(message.subject),
    text: quoteText(message.text, quoteHeader),
    inReplyTo: message.id,
    files: [],
  };
}
