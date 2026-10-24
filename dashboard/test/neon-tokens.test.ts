// WCAG AA contrast for the georg-ds neon accents (0.3, promoted from georg-mail) in every pairing
// georg-mail's own rules use, so a design system upgrade cannot quietly break them.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, test } from "vitest";

const MIN_TEXT_CONTRAST = 4.5;
const ACCENTS = ["purple", "fuchsia", "green", "blue", "orange"] as const;
const THEMES = ["light", "dark"] as const;
type Tokens = Record<string, string>;
type Rgb = [number, number, number];

// Paths from the repository root: under jsdom, import.meta.url is not a file URL.
const ROOT = process.cwd();
const designSystemCss = readFileSync(
  createRequire(path.join(ROOT, "package.json")).resolve("@shipibo-studio/georg-ds/georg.css"),
  "utf8",
);

/** Custom properties of every rule block, keyed by selector. Later files override earlier ones. */
function tokenBlocks(css: string): Map<string, Tokens> {
  const blocks = new Map<string, Tokens>();
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const [, selector = "", body = ""] of withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const tokens: Tokens = {};
    for (const [, name = "", value = ""] of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) tokens[name] = value.trim();
    if (Object.keys(tokens).length > 0) blocks.set(selector.trim(), tokens);
  }
  return blocks;
}

const LAYERS = [tokenBlocks(designSystemCss)];

/** The cascade of georg.css: root, dark, the accent, then the dark accent (by specificity). */
function selectorsFor(theme: (typeof THEMES)[number], accent: (typeof ACCENTS)[number]): string[] {
  const selectors = [":root"];
  if (theme === "dark") selectors.push('[data-theme="dark"]');
  if (accent !== "purple") {
    selectors.push(`[data-accent="${accent}"]`);
    if (theme === "dark") selectors.push(`[data-theme="dark"][data-accent="${accent}"]`);
  }
  return selectors;
}

function resolveTokens(theme: (typeof THEMES)[number], accent: (typeof ACCENTS)[number]): Tokens {
  const tokens: Tokens = {};
  // Same specificity, so source order decides: the neon file loads after georg-ds.
  for (const selector of selectorsFor(theme, accent)) {
    for (const layer of LAYERS) Object.assign(tokens, layer.get(selector));
  }
  return tokens;
}

function resolveValue(tokens: Tokens, name: string): string {
  const value = tokens[name];
  if (value === undefined) throw new Error(`${name} is not defined`);
  const reference = /^var\((--[\w-]+)\)$/.exec(value);
  return reference?.[1] ? resolveValue(tokens, reference[1]) : value;
}

function parseColor(value: string): { rgb: Rgb; alpha: number } {
  const hexDigits = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value)?.[1];
  if (hexDigits) {
    const digits = hexDigits.length === 3 ? [...hexDigits].map((digit) => digit + digit).join("") : hexDigits;
    const rgb = [0, 2, 4].map((offset) => Number.parseInt(digits.slice(offset, offset + 2), 16)) as Rgb;
    return { rgb, alpha: 1 };
  }
  const rgba = /^rgba\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)$/i.exec(value);
  if (rgba) return { rgb: rgba.slice(1, 4).map(Number) as Rgb, alpha: Number(rgba[4]) };
  throw new Error(`Unsupported color: ${value}`);
}

function relativeLuminance(rgb: Rgb): number {
  const linear = (channel: number) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(rgb[0]) + 0.7152 * linear(rgb[1]) + 0.0722 * linear(rgb[2]);
}

function contrastRatio(foreground: Rgb, background: Rgb): number {
  const [first, second] = [relativeLuminance(foreground), relativeLuminance(background)];
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

const flatten = (color: { rgb: Rgb; alpha: number }, background: Rgb): Rgb =>
  color.rgb.map((channel, index) =>
    Math.round(channel * color.alpha + (background[index] ?? 0) * (1 - color.alpha)),
  ) as Rgb;

describe("neon accents", () => {
  for (const theme of THEMES) {
    for (const accent of ACCENTS) {
      test(`${theme} theme with ${accent} accent meets WCAG AA`, () => {
        const tokens = resolveTokens(theme, accent);
        const color = (name: string) => parseColor(resolveValue(tokens, name));
        const opaque = (name: string) => color(name).rgb;
        const failures: string[] = [];
        const check = (label: string, foreground: Rgb, background: Rgb) => {
          const ratio = contrastRatio(foreground, background);
          if (ratio < MIN_TEXT_CONTRAST) failures.push(`${label}: ${ratio.toFixed(2)}:1`);
        };

        for (const surface of ["--bg", "--bg-elev"])
          check(`--accent on ${surface}`, opaque("--accent"), opaque(surface));
        // Active navigation, tabs and palette items: accent text on the soft highlight, over every surface.
        for (const surface of ["--bg", "--bg-elev", "--bg-sunken"]) {
          check(
            `--accent on --accent-soft over ${surface}`,
            opaque("--accent"),
            flatten(color("--accent-soft"), opaque(surface)),
          );
        }
        check("--on-accent on --accent", opaque("--on-accent"), opaque("--accent"));
        // Hover and pressed states keep the same guarantees.
        check("--accent-2 on --bg-elev", opaque("--accent-2"), opaque("--bg-elev"));
        check("--on-accent on --accent-2", opaque("--on-accent"), opaque("--accent-2"));

        expect(failures).toEqual([]);
      });

      test(`${theme} theme with ${accent} accent derives every accent token from one hue`, () => {
        const tokens = resolveTokens(theme, accent);
        const accentRgb = parseColor(resolveValue(tokens, "--accent")).rgb;
        for (const name of ["--accent-soft", "--accent-ring", "--accent-glow-color"]) {
          expect(parseColor(resolveValue(tokens, name)).rgb, name).toEqual(accentRgb);
        }
        // The palette entry is the accent itself, so a swatch shows exactly what selecting it gives.
        expect(resolveValue(tokens, `--accent-${accent}`)).toBe(resolveValue(tokens, "--accent"));
      });
    }
  }

  test("dark mode is the neon palette of the Georg avatar", () => {
    const tokens = resolveTokens("dark", "purple");
    expect(
      ["--accent-fuchsia", "--accent-green", "--accent-blue", "--accent-orange"].map((name) => tokens[name]),
    ).toEqual(["#ff2e88", "#7cff00", "#00e5ff", "#ff6a00"]);
  });
});
