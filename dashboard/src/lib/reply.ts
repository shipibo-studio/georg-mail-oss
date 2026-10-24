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
  /** One of the mailbox's aliases to send from; null sends from the mailbox's own address. */
  from: string | null;
}

export const EMPTY_DRAFT: Draft = { to: [], cc: [], subject: "", text: "", inReplyTo: null, files: [], from: null };

export function replySubject(subject: string | null): string {
  const base = (subject ?? "").trim();
  return REPLY_PREFIX.test(base) ? base : `Re: ${base}`.trim();
}

/** Quotes the original below an empty line for the reply, like every mail client does. */
export function quoteText(text: string | null, header: string): string {
  const lines = (text ?? "").replace(/\r\n/g, "\n").trimEnd().split("\n").slice(0, MAX_QUOTED_LINES);
  return `\n\n${header}\n${lines.map((line) => `> ${line}`).join("\n")}`;
}

/**
 * Answers from the address the original reached (or, for sent mail, went out from) when that is one
 * of the mailbox's aliases, so a conversation keeps one address.
 */
export function replyFrom(message: FullMessage, aliases: string[]): string | null {
  const address = (message.direction === "sent" ? message.from.address : message.to)?.trim().toLowerCase();
  return address && aliases.includes(address) ? address : null;
}

export function replyDraft(message: FullMessage, quoteHeader: string, aliases: string[] = []): Draft {
  const to = message.direction === "sent" ? (message.recipients ?? []) : [message.from.address ?? ""];
  return {
    to: to.filter(Boolean),
    cc: [],
    subject: replySubject(message.subject),
    text: quoteText(message.text, quoteHeader),
    inReplyTo: message.id,
    files: [],
    from: replyFrom(message, aliases),
  };
}
