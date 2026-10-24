// Full-text search of personal mail over the message_search FTS5 index (migration 0020).
import { type SQL, sql } from "drizzle-orm";
import { messages } from "../db/schema";

/** Longest search the dashboard sends; more terms than this are ignored. */
export const MAX_SEARCH_LENGTH = 200;
const MAX_TERMS = 8;
const MAX_TERM_LENGTH = 64;
// A term worth matching has a letter or a digit; the tokenizer drops everything else.
const HAS_WORD = /[\p{L}\p{N}]/u;

/**
 * Turns what the owner typed into an FTS5 query that cannot use FTS5's own syntax: every term is
 * quoted (so OR, NOT, NEAR, column filters and parentheses are plain words) and matches as a
 * prefix, and all terms must appear. Null when nothing searchable is left.
 */
export function searchMatchQuery(input: string): string | null {
  const terms = input
    .normalize("NFKC")
    .split(/\s+/)
    .map((term) => term.replaceAll('"', "").slice(0, MAX_TERM_LENGTH))
    .filter((term) => HAS_WORD.test(term))
    .slice(0, MAX_TERMS);
  return terms.length > 0 ? terms.map((term) => `"${term}"*`).join(" ") : null;
}

/** Personal messages whose subject, people or visible text match. */
export function matchesSearch(matchQuery: string): SQL {
  return sql`${messages.searchRowid} IN (SELECT rowid FROM message_search WHERE message_search MATCH ${matchQuery})`;
}
