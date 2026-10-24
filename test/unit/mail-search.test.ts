import { describe, expect, test } from "vitest";
import { searchMatchQuery } from "../../src/worker/dashboard/mail-search";

describe("search query", () => {
  test("quotes every term as a prefix, all of them required", () => {
    expect(searchMatchQuery("factura  abril")).toBe('"factura"* "abril"*');
    expect(searchMatchQuery("noreply@github.com")).toBe('"noreply@github.com"*');
  });

  test("FTS5 operators, column filters and quotes become plain words", () => {
    expect(searchMatchQuery('a OR b NOT c NEAR(d e) subject:x "quoted"')).toBe(
      '"a"* "OR"* "b"* "NOT"* "c"* "NEAR(d"* "e)"* "subject:x"*',
    );
    expect(searchMatchQuery('say "hi" now')).toBe('"say"* "hi"* "now"*');
  });

  test("nothing searchable is null", () => {
    expect(searchMatchQuery("")).toBeNull();
    expect(searchMatchQuery("   ")).toBeNull();
    expect(searchMatchQuery('!!! *** ""')).toBeNull();
  });

  test("keeps letters and digits of any script, and caps terms and their length", () => {
    expect(searchMatchQuery("ваш код 482913")).toBe('"ваш"* "код"* "482913"*');
    expect(searchMatchQuery("Ｆａｃｔｕｒａ")).toBe('"Factura"*');
    const many = Array.from({ length: 12 }, (_, index) => `t${index}`).join(" ");
    expect(searchMatchQuery(many)?.split(" ")).toHaveLength(8);
    expect(searchMatchQuery("x".repeat(100))).toBe(`"${"x".repeat(64)}"*`);
  });
});
