import { describe, expect, test } from "vitest";
import { foldForSearch, searchColumns } from "../../src/worker/messages/text-folding";

describe("search folding", () => {
  test.each([
    ["Código de verificación", "codigo de verificacion"],
    ["ÉCOLE", "ecole"],
    ["Straße", "strasse"],
    ["ΣΟΦΟΣ σοφος", "σοφοσ σοφοσ"],
    ["ПРИВЕТ", "привет"],
    ["İstanbul", "istanbul"],
    // Fullwidth and compatibility forms become their plain equivalents.
    ["ＣＯＤＥ ①", "code 1"],
    ["plain ascii 100%", "plain ascii 100%"],
  ])("folds %j to %j", (text, folded) => {
    expect(foldForSearch(text)).toBe(folded);
  });

  test("the same word matches however it is cased or accented", () => {
    for (const variant of ["CÓDIGO", "código", "Codigo", "CODIGO"]) expect(foldForSearch(variant)).toBe("codigo");
  });

  test("strips stacks of combining marks used to disguise text", () => {
    const disguised = `c${String.fromCodePoint(0x0301).repeat(30)}ode`;
    expect(foldForSearch(disguised)).toBe("code");
  });

  test("builds the searchable columns of a row, keeping a missing subject missing", () => {
    expect(searchColumns({ fromAddress: "Ana@Ñandú.test", subject: "Hola" })).toEqual({
      fromFolded: "ana@nandu.test",
      subjectFolded: "hola",
    });
    expect(searchColumns({ fromAddress: "a@b.test", subject: null }).subjectFolded).toBeNull();
  });
});
