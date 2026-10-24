// Search text folded for case- and accent-insensitive matching in any script. SQLite's lower() only
// folds ASCII, so the folded form is computed here, stored next to the original, and compared with
// the folded filter text.

const COMBINING_MARKS = /\p{M}/gu;
// Full case folding pairs that toLowerCase() leaves apart.
const EXTRA_FOLDS: [RegExp, string][] = [
  [/ß/g, "ss"],
  [/ς/g, "σ"],
];

/** "Código ÉCOLE Straße" → "codigo ecole strasse". */
export function foldForSearch(text: string): string {
  let folded = text.normalize("NFKD").replace(COMBINING_MARKS, "").toLowerCase();
  for (const [pattern, replacement] of EXTRA_FOLDS) folded = folded.replace(pattern, replacement);
  return folded.normalize("NFKC");
}

/** The searchable columns of a message row, folded. */
export function searchColumns(row: { fromAddress: string; subject: string | null }) {
  return {
    fromFolded: foldForSearch(row.fromAddress),
    subjectFolded: row.subject === null ? null : foldForSearch(row.subject),
  };
}
