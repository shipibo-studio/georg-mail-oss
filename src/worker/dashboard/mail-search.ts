// Full-text search of personal mail over the message_search FTS5 index (migration 0020). The query
// is parsed in mail-search-query.ts and never reaches FTS5's own syntax: every term is quoted, so
// OR, NOT, NEAR, column filters and parentheses are plain words.
import { and, gt, gte, lt, not, type SQL, sql } from "drizzle-orm";
import { messages } from "../db/schema";
import { foldForSearch } from "../messages/text-folding";
import { type MailSearch, type SearchTerm, startOfDay } from "./mail-search-query";

export { MAX_SEARCH_LENGTH, parseSearch } from "./mail-search-query";

/** One FTS5 term: a quoted prefix ("factura"*) or a quoted phrase ("hasta luego"). */
export function ftsTerm(term: SearchTerm): string {
  return term.phrase ? `"${term.text}"` : `"${term.text}"*`;
}

/** The FTS5 query every result must match, or null when there are only exclusions and filters. */
export function matchQuery(search: MailSearch): string | null {
  const positive = search.terms.filter((term) => !term.negated).map(ftsTerm);
  return positive.length > 0 ? positive.join(" ") : null;
}

/** The FTS5 query no result may match. */
export function excludeQuery(search: MailSearch): string | null {
  const negative = search.terms.filter((term) => term.negated).map(ftsTerm);
  return negative.length > 0 ? negative.join(" OR ") : null;
}

function inIndex(query: string): SQL {
  return sql`coalesce(${messages.searchRowid}, 0) IN (SELECT rowid FROM message_search WHERE message_search MATCH ${query})`;
}

/** A LIKE pattern for a substring, with LIKE's own wildcards taken literally. */
function containing(text: string): string {
  return `%${text.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}

function fromSender(text: string): SQL {
  return sql`(coalesce(${messages.fromFolded}, '') LIKE ${containing(foldForSearch(text))} ESCAPE '\\' OR coalesce(${messages.fromName}, '') LIKE ${containing(text)} ESCAPE '\\')`;
}

/** The SQL conditions of a parsed search; dates are days where the person searching is. */
export function searchConditions(search: MailSearch, timezoneOffsetMinutes = 0): SQL | undefined {
  const match = matchQuery(search);
  const exclude = excludeQuery(search);
  return and(
    match ? inIndex(match) : undefined,
    exclude ? not(inIndex(exclude)) : undefined,
    ...search.senders.map((sender) => (sender.negated ? not(fromSender(sender.text)) : fromSender(sender.text))),
    search.hasAttachment === true ? gt(messages.attachmentCount, 0) : undefined,
    search.hasAttachment === false ? sql`${messages.attachmentCount} = 0` : undefined,
    search.after ? gte(messages.receivedAt, startOfDay(search.after, timezoneOffsetMinutes)) : undefined,
    search.before ? lt(messages.receivedAt, startOfDay(search.before, timezoneOffsetMinutes)) : undefined,
  );
}
