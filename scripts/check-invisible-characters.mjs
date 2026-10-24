// Fails when a tracked text file contains invisible or bidirectional Unicode characters. They can
// make code read differently from how it runs ("Trojan Source", CVE-2021-42574), and formatters
// sometimes turn \u escapes into the literal characters. Write such characters as \u escapes or
// String.fromCodePoint instead.
//
// Usage: pnpm lint:unicode
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

// Concatenated strings on purpose: Biome rewrites \u escapes in regex literals with the u flag as the
// characters themselves, which would hide them from review.
const INVISIBLE = new RegExp(
  "[\\u00AD\\u034F\\u061C\\u115F\\u1160\\u17B4\\u17B5\\u180B-\\u180F\\u200B-\\u200F\\u202A-\\u202E" +
    "\\u2060-\\u2064\\u2066-\\u206F\\u3164\\uFEFF\\uFFA0\\u{E0000}-\\u{E007F}\\u{E0100}-\\u{E01EF}]",
  "u",
);
const BINARY_EXTENSIONS = /\.(?:png|jpe?g|gif|webp|ico|pdf|woff2?|ttf|otf|eml|zip)$/i;

const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter((file) => file && !BINARY_EXTENSIONS.test(file));

const findings = [];
for (const file of files) {
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, index) => {
    const match = line.match(INVISIBLE);
    if (match) {
      const codePoint = match[0].codePointAt(0).toString(16).toUpperCase().padStart(4, "0");
      findings.push(`${file}:${index + 1}: U+${codePoint}`);
    }
  });
}

if (findings.length > 0) {
  console.error(`Invisible or bidirectional characters found:\n${findings.join("\n")}`);
  process.exit(1);
}
console.log(`No invisible characters in ${files.length} tracked files.`);
