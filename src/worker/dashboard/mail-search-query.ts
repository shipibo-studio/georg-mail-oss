// What the owner types in the mail search, parsed: words and "exact phrases" (either with a leading
// - to leave them out), and the operators people know from other mail clients: from:, has:attachment,
// after: and before:. Pure, so the Worker (mail-search.ts) and the dashboard's mock share it.

/** Longest search the dashboard sends; more terms than this are ignored. */
export const MAX_SEARCH_LENGTH = 200;
const MAX_TERMS = 8;
const MAX_TERM_LENGTH = 64;
const MAX_SENDER_FILTERS = 3;
const MINUTE_MS = 60_000;
// A term worth matching has a letter or a digit; the index's tokenizer drops everything else.
const HAS_WORD = /[\p{L}\p{N}]/u;
// An optional "-", an optional "name:", then a "quoted phrase" (closed or not) or a bare word.
const TOKEN = /(-?)(?:([a-z]+):)?(?:"([^"]*)"?|(\S+))/giu;
const DATE = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/;
// An operator typed without its value yet ("from:"): nothing to search for.
const BARE_OPERATOR = /^(from|has|after|before):$/i;

export interface SearchTerm {
  text: string;
  /** Quoted: these words, together and in this order. Otherwise a word that starts with `text`. */
  phrase: boolean;
  negated: boolean;
}

export interface SearchDay {
  year: number;
  month: number;
  day: number;
}

export interface MailSearch {
  terms: SearchTerm[];
  /** Part of the sender's address or name. */
  senders: { text: string; negated: boolean }[];
  /** true: only mail with attachments; false: only mail without. */
  hasAttachment: boolean | null;
  /** On or after this day, where the person searching is. */
  after: SearchDay | null;
  /** Before this day (not on it), where the person searching is. */
  before: SearchDay | null;
}

function cleanTerm(value: string): string | null {
  const term = value.replaceAll('"', "").trim().slice(0, MAX_TERM_LENGTH);
  return HAS_WORD.test(term) ? term : null;
}

function parseDay(value: string): SearchDay | null {
  const match = DATE.exec(value);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  const real = date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  return real ? { year, month, day } : null;
}

/** The search, or null when nothing searchable is left. */
export function parseSearch(input: string): MailSearch | null {
  const search: MailSearch = { terms: [], senders: [], hasAttachment: null, after: null, before: null };
  for (const token of input.normalize("NFKC").matchAll(TOKEN)) {
    const negated = token[1] === "-";
    const operator = token[2]?.toLowerCase();
    const phrase = token[3];
    const value = phrase ?? token[4] ?? "";
    if (!operator && BARE_OPERATOR.test(value)) continue;
    if (operator === "from") {
      const text = cleanTerm(value);
      if (text && search.senders.length < MAX_SENDER_FILTERS) search.senders.push({ text, negated });
      continue;
    }
    if (operator === "has" && /^attachments?$/i.test(value)) {
      search.hasAttachment = !negated;
      continue;
    }
    const day = operator === "after" || operator === "before" ? parseDay(value) : null;
    if ((operator === "after" || operator === "before") && day && !negated) {
      search[operator] = day;
      continue;
    }
    // Anything else is text, an unknown operator's name included ("subject:x" is one word).
    const text = cleanTerm(operator ? `${operator}:${value}` : value);
    if (!text || search.terms.length >= MAX_TERMS) continue;
    search.terms.push({ text, phrase: phrase !== undefined && !operator, negated });
  }
  const filtered =
    search.senders.length > 0 || search.hasAttachment !== null || search.after !== null || search.before !== null;
  return search.terms.length > 0 || filtered ? search : null;
}

/** Midnight of `day` where the person searching is, `offsetMinutes` behind UTC (getTimezoneOffset). */
export function startOfDay(day: SearchDay, offsetMinutes: number): number {
  return Date.UTC(day.year, day.month - 1, day.day) + offsetMinutes * MINUTE_MS;
}
