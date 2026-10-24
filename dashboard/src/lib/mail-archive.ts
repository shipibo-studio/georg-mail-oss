// Turns what the owner picked to import (a Zoho export .zip, an .mbox, loose .eml files) into single
// messages, in the browser, so the Worker only ever receives one message per request.
import { unzipSync } from "fflate";

/** The Worker's limit for one imported message; larger zip entries are skipped before inflating. */
export const MAX_MESSAGE_BYTES = 25 * 1024 * 1024;
/** A whole mailbox inside a zip, inflated in the browser's memory: beyond this, export it in parts. */
const MAX_MBOX_BYTES = 512 * 1024 * 1024;
const EML_FILE = /\.eml$/i;
const MBOX_FILE = /\.(?:mbox|mbx)$/i;
const ZIP_FILE = /\.zip$/i;
// macOS adds resource forks to zips it creates; they look like .eml files but are not mail.
const MACOS_METADATA = /(?:^|\/)__MACOSX\/|(?:^|\/)\._/;

const NEWLINE = 10;
const CARRIAGE_RETURN = 13;
const GREATER_THAN = 62;
const FROM_LINE = [70, 114, 111, 109, 32]; // "From "

export interface ArchiveMessage {
  /** Where it came from, for the owner: "export.zip › Inbox/123.eml". */
  label: string;
  read(): Promise<Uint8Array>;
}

export const isImportable = (name: string) => EML_FILE.test(name) || MBOX_FILE.test(name) || ZIP_FILE.test(name);

function startsWith(bytes: Uint8Array, at: number, pattern: number[]): boolean {
  return pattern.every((byte, offset) => bytes[at + offset] === byte);
}

function lineStarts(bytes: Uint8Array): number[] {
  const starts = [0];
  for (let index = 0; index < bytes.length - 1; index += 1) {
    if (bytes[index] === NEWLINE) starts.push(index + 1);
  }
  return starts;
}

/** mboxrd quotes body lines that start with "From " as ">From "; one ">" comes off every such line. */
function unquoteFromLines(message: Uint8Array): Uint8Array {
  const quoted = lineStarts(message).filter((start) => {
    let at = start;
    while (message[at] === GREATER_THAN) at += 1;
    return at > start && startsWith(message, at, FROM_LINE);
  });
  if (quoted.length === 0) return message;
  const result = new Uint8Array(message.length - quoted.length);
  let read = 0;
  let written = 0;
  for (const start of quoted) {
    result.set(message.subarray(read, start), written);
    written += start - read;
    read = start + 1;
  }
  result.set(message.subarray(read), written);
  return result;
}

/** Without the blank line mbox puts between messages. */
function withoutTrailingBlankLine(message: Uint8Array): Uint8Array {
  let end = message.length;
  if (message[end - 1] === NEWLINE) end -= 1;
  if (message[end - 1] === CARRIAGE_RETURN) end -= 1;
  return message.subarray(0, end);
}

/**
 * Splits an mbox file at its "From " separator lines, which are dropped. A file without any is one
 * message (an .eml saved under the wrong name).
 */
export function splitMbox(bytes: Uint8Array): Uint8Array[] {
  const separators = lineStarts(bytes).filter((start) => startsWith(bytes, start, FROM_LINE));
  if (separators.length === 0) return bytes.length > 0 ? [bytes] : [];
  return separators
    .map((start, index) => {
      const lineEnd = bytes.indexOf(NEWLINE, start);
      const bodyStart = lineEnd === -1 ? bytes.length : lineEnd + 1;
      const end = separators[index + 1] ?? bytes.length;
      return unquoteFromLines(withoutTrailingBlankLine(bytes.subarray(bodyStart, end)));
    })
    .filter((message) => message.length > 0);
}

/**
 * Message files inside a zip, without inflating any: only the directory is read. Entries larger than
 * one message can be are skipped here, so a zip bomb never gets inflated.
 */
export function zipEntries(zip: Uint8Array): string[] {
  const names: string[] = [];
  unzipSync(zip, {
    filter: (file) => {
      const wanted =
        (EML_FILE.test(file.name) || MBOX_FILE.test(file.name)) &&
        !MACOS_METADATA.test(file.name) &&
        file.originalSize <= (MBOX_FILE.test(file.name) ? MAX_MBOX_BYTES : MAX_MESSAGE_BYTES);
      if (wanted) names.push(file.name);
      return false;
    },
  });
  return names;
}

/** Inflates one entry of a zip. */
export function zipEntry(zip: Uint8Array, name: string): Uint8Array | null {
  return unzipSync(zip, { filter: (file) => file.name === name })[name] ?? null;
}

const mboxMessages = (label: string, mbox: Uint8Array): ArchiveMessage[] =>
  splitMbox(mbox).map((bytes, index) => ({ label: `${label} #${index + 1}`, read: async () => bytes }));

/** Every message in the picked files, each read only when it is about to be sent. */
export async function collectMessages(files: File[]): Promise<ArchiveMessage[]> {
  const found: ArchiveMessage[] = [];
  for (const file of files) {
    if (EML_FILE.test(file.name)) {
      found.push({ label: file.name, read: async () => new Uint8Array(await file.arrayBuffer()) });
    } else if (MBOX_FILE.test(file.name)) {
      found.push(...mboxMessages(file.name, new Uint8Array(await file.arrayBuffer())));
    } else if (ZIP_FILE.test(file.name)) {
      const zip = new Uint8Array(await file.arrayBuffer());
      for (const name of zipEntries(zip)) {
        const label = `${file.name} › ${name}`;
        if (MBOX_FILE.test(name)) {
          found.push(...mboxMessages(label, zipEntry(zip, name) ?? new Uint8Array()));
        } else {
          found.push({ label, read: async () => zipEntry(zip, name) ?? new Uint8Array() });
        }
      }
    }
  }
  return found;
}
