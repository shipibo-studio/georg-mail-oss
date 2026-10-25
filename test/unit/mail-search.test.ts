// What the owner types in the mail search: words, "exact phrases", -exclusions and the operators
// from:, has:attachment, after: and before:, turned into FTS5 queries that cannot use FTS5's syntax.
import { describe, expect, test } from "vitest";
import { excludeQuery, matchQuery, parseSearch } from "../../src/worker/dashboard/mail-search";
import { startOfDay } from "../../src/worker/dashboard/mail-search-query";

const match = (input: string) => {
  const search = parseSearch(input);
  return search ? matchQuery(search) : null;
};
const exclude = (input: string) => {
  const search = parseSearch(input);
  return search ? excludeQuery(search) : null;
};

describe("words and phrases", () => {
  test("every word is a quoted prefix, all of them required", () => {
    expect(match("factura  abril")).toBe('"factura"* "abril"*');
    expect(match("noreply@github.com")).toBe('"noreply@github.com"*');
  });

  test("a quoted phrase matches those words together, not as prefixes", () => {
    expect(match('say "hasta luego" now')).toBe('"say"* "hasta luego" "now"*');
    expect(match('"unclosed phrase')).toBe('"unclosed phrase"');
  });

  test("FTS5 operators, column filters and parentheses stay plain words", () => {
    expect(match("a OR b NOT c NEAR(d e) subject:x")).toBe('"a"* "OR"* "b"* "NOT"* "c"* "NEAR(d"* "e)"* "subject:x"*');
  });

  test("a leading - leaves words and phrases out", () => {
    expect(match("factura -borrador")).toBe('"factura"*');
    expect(exclude('factura -borrador -"no responder"')).toBe('"borrador"* OR "no responder"');
    // Only exclusions is still a search.
    expect(match("-newsletter")).toBeNull();
    expect(exclude("-newsletter")).toBe('"newsletter"*');
  });

  test("keeps letters and digits of any script, and caps terms and their length", () => {
    expect(match("ваш код 482913")).toBe('"ваш"* "код"* "482913"*');
    expect(match("Ｆａｃｔｕｒａ")).toBe('"Factura"*');
    const many = Array.from({ length: 12 }, (_, index) => `t${index}`).join(" ");
    expect(match(many)?.split(" ")).toHaveLength(8);
    expect(match("x".repeat(100))).toBe(`"${"x".repeat(64)}"*`);
  });
});

describe("operators", () => {
  test("from: filters by sender, and -from: leaves a sender out", () => {
    expect(parseSearch("from:camila factura")).toMatchObject({
      senders: [{ text: "camila", negated: false }],
      terms: [{ text: "factura", phrase: false, negated: false }],
    });
    expect(parseSearch('-from:"Banco Seguro"')?.senders).toEqual([{ text: "Banco Seguro", negated: true }]);
    expect(parseSearch("from:a from:b from:c from:d")?.senders).toHaveLength(3);
  });

  test("has:attachment keeps mail with files, -has:attachment mail without", () => {
    expect(parseSearch("has:attachment")?.hasAttachment).toBe(true);
    expect(parseSearch("HAS:Attachments")?.hasAttachment).toBe(true);
    expect(parseSearch("-has:attachment")?.hasAttachment).toBe(false);
    expect(parseSearch("has:star")?.terms).toEqual([{ text: "has:star", phrase: false, negated: false }]);
  });

  test("after: and before: take real days; anything else is a word", () => {
    expect(parseSearch("after:2026-10-01 before:2026/10/31")).toMatchObject({
      after: { year: 2026, month: 10, day: 1 },
      before: { year: 2026, month: 10, day: 31 },
    });
    expect(parseSearch("after:2026-02-30")?.after).toBeNull();
    expect(parseSearch("after:yesterday")?.terms).toEqual([{ text: "after:yesterday", phrase: false, negated: false }]);
  });

  test("a day starts at midnight where the person searching is", () => {
    // Santiago in October is UTC-3: getTimezoneOffset() is 180.
    expect(new Date(startOfDay({ year: 2026, month: 10, day: 1 }, 180)).toISOString()).toBe("2026-10-01T03:00:00.000Z");
    expect(new Date(startOfDay({ year: 2026, month: 10, day: 1 }, -120)).toISOString()).toBe(
      "2026-09-30T22:00:00.000Z",
    );
  });
});

describe("nothing to search", () => {
  test("is null", () => {
    expect(parseSearch("")).toBeNull();
    expect(parseSearch("   ")).toBeNull();
    expect(parseSearch('!!! *** "" -')).toBeNull();
    expect(parseSearch("from:")).toBeNull();
  });
});
