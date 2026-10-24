# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.0] - 2026-10-18

### Added

- **`src/tokens.json` for native apps** (`npm run tokens`). Every token of `georg.css` resolved per theme (`themes.light`, `themes.dark`) and per accent (`accents.<name>.<theme>`, only the accent tokens), with colors as `#rrggbb` or `#rrggbbaa`, lengths and durations as numbers, easings as control points, shadows as layers and fonts as family lists. It is exported as `@shipibo-studio/georg-ds/tokens.json` and attached to each GitHub release, so Swift apps never need an npm token. A unit test fails when it no longer matches `georg.css`. Consumer impact: **georg-port** can read it instead of hand-copying values; nothing changes for the others.
- **Accent palette and glow:** `--accent-purple`, `--accent-fuchsia`, `--accent-green`, `--accent-blue` and `--accent-orange` (every accent at once, for pickers and swatches; `--accent` points to the active one), `--accent-glow-color` and `--accent-glow` (ring plus light for small solid accent elements). Promoted from georg-mail.
- The contrast test also checks `--accent-2` on `--bg-elev`, `--on-accent` on `--accent-2`, and soft fills over `--bg-sunken`.

### Changed

- **Neon accents**, promoted from georg-mail after the user approved them. Dark mode uses the Georg avatar's neon palette (`#c06aff`, `#ff2e88`, `#7cff00`, `#00e5ff`, `#ff6a00`); light mode uses deep, saturated hues that pass AA (`#8f00f5`, `#c40062`, `#007527`, `#005edb`, `#b04000`), with new `--accent-2`, `--accent-soft` and `--accent-ring` values. `georgTheme.ACCENTS` swatches follow the light values. The brand purple (logo, `docs/brand-identity.md`) becomes `#8f00f5` / `#c06aff`. Consumer impact: **georg-mail** can delete `dashboard/src/georg-mail-tokens.css` and keep only its app-specific neon rules; **georg-website** sees its purple turn neon (no code change; its hero uses `#c06aff` in dark); **georg-app** has no code yet; **georg-port** should remap its accents (or read `tokens.json`).
- Light `--danger` deepens again to `#c41d1d` (was `#cc1f1f` in 0.2.2) so it passes AA on `--danger-soft` over `--bg-sunken` too. Consumer impact: **georg-mail** and **georg-port** get a slightly deeper red; no code change.
- `docs/native.md` documents `tokens.json`, two more icons (do not close, unclassified) and observing the shared suite with key-value observing.

## [0.2.2] - 2026-10-18

### Fixed

- Colored text on its soft fill was below WCAG AA in the light theme, found by georg-port: `--danger` on `--danger-soft` (4.10:1 over `--bg`, 4.28:1 over `--bg-elev`) and the blue `--accent` on its `--accent-soft` over `--bg` (4.44:1). Light `--danger` is now `#cc1f1f` (was `#dc2626`) with `--danger-soft` in the same hue, and the light blue `--accent-soft` drops from 8% to 6%; the blue accent itself is unchanged. The contrast test now checks every soft fill over both `--bg` and `--bg-elev`. Consumer impact: **georg-mail**'s danger chips and press-and-hold fill get a slightly deeper red, no code change; **georg-port** can drop its outline-only workaround for danger tags (its test expecting the failure will now fail on purpose); **georg-app** and **georg-website** need no change.

### Added

- `docs/native.md`: how georg-ds applies to native and desktop apps. 1 CSS px = 1 pt; SF Symbols in native chrome and Tabler on the web, with a shared concept table; theme and accent shared through the `cc.dasgeorg.shared` UserDefaults suite with the same keys as `localStorage`; tokens govern content while system chrome stays native; desktop readings of polling, destructive actions, toasts and hover. Consumer impact: **georg-port** follows it now; **georg-app** follows it when it has code.
- `docs/roadmap.md`: gap analysis for the desktop and native apps and the v0.3 plan (tokens.json, neon accents, georg-mail patterns, desktop tokens, a macOS platform layer, a storage adapter for `georg-theme.js`).
- `CREDITS.md` pins the native font files (Geist v1.8.1 with its sha256, Stack Sans Notch at a google/fonts commit).
- `docs/accessibility.md`: no colored text on a soft fill over `--bg-hover`, which fails AA in the light theme.
- AGENTS.md lists `--success-soft` and `--warn-soft`, incubating in georg-port.

## [0.2.1] - 2026-10-18

### Fixed

- `georgTheme.setTheme()` followed by `setAccent()` in the same tick (or the other way round) lost the first change: the second call read the theme back from `<html>` before the view transition had written it. `georg-theme.js` now keeps the requested state itself, `get()` returns the latest request even mid-transition, and a late transition callback always writes the newest state. Covered by unit tests with real view transition timing and by an end-to-end test in Chromium. Consumer impact: **georg-mail**, which reported it, gets the fix by upgrading to 0.2.1; **georg-app** and **georg-website** need no change.

### Added

- `demo/styleguide.html`: a styleguide of every released version and the unreleased work. It shows colors with their contrast, type, radii, shadows, motion and primitives in any theme and accent, plus the token changes and changelog between any two versions. `npm run styleguide` regenerates its data from the CHANGELOG and the git tags, and a unit test fails when the data is stale. Documentation only; no consumer impact.
- AGENTS.md lists the neon accents incubating in georg-mail (`--accent-<name>`, `--accent-glow-color`, `--accent-glow` and their component rules), pending the user's approval. Documentation only; no consumer impact.
- `docs/theming.md`: the always-dark section pattern (`data-theme="dark"` on a section) and its caveat: the dark accent rules need `data-accent` on the same element. AGENTS.md lists `--text-display` as incubating in georg-website. Documentation only; no consumer impact.

### Changed

- `docs/brand-identity.md`: Georg port joins the family and the brand architecture. The naming rule now covers auxiliary apps: "Georg" + a lowercase descriptor in running text (Georg mail, Georg port), PascalCase only in identifiers (`GeorgPort.app`). Documentation only. Consumer impact: **georg-port** should show "Georg port" as its display name; no change for georg-mail, georg-app or georg-website.

## [0.2.0] - 2026-10-18

### Added

- `docs/react-implementation.md`: how the georg-mail dashboard builds georg-ds in React (Motion, morphicons, TanStack Query). It covers the named springs and durations, every interaction pattern and where it lives, phone layout and gestures, untrusted content, accessibility, testing motion with Playwright, and the candidates for promotion to v0.2. Documentation only, no token or class changes. Consumer impact: **georg-app** should follow it for its UI so both apps feel the same; **georg-mail** is the source of these patterns and needs no change.
- `docs/brand-identity.md`: brand identity proposal for the georg family (Georg and Georg mail): essence, naming and brand architecture, slogan and taglines, logo concepts with sketches in `docs/brand/`, color and type, voice and tone, and first applications. Documentation only. Consumer impact: **georg-app** and **georg-mail** should follow its naming and voice rules; no code change.
- `docs/website.md`: design direction for the `dasgeorg.cc` website, using talanoa.email as inspiration (no code or assets copied). Documentation only; no consumer impact.
- Reference guides in `docs/`: `foundations.md`, `theming.md`, `patterns.md`, `components.md` and `accessibility.md`, moved out of `README.md` without content changes.
- Automated WCAG AA contrast test for every theme and accent (`npm test`).
- Unit tests for `georg-theme.js` against a simulated browser, with a minimum of 85% line, branch and function coverage (`npm run test:coverage`; currently 100%).
- End-to-end tests in Chromium with Playwright through `demo/dashboard.html`: theme resolved before first paint, persistence, live OS changes, cross-tab sync, keyboard use and reduced motion (`npm run test:e2e`).
- `CREDITS.md` with the licenses of the fonts, icons, conventions and tools the design system uses.
- Repository standards: CI and security workflows (gitleaks, semgrep), Dependabot, CODEOWNERS, issue and pull request templates, `CONTRIBUTING.md`, `SECURITY.md`, `AGENTS.md`, `.editorconfig`.

### Changed

- **Published as `@shipibo-studio/georg-ds` on GitHub Packages** (private), by `.github/workflows/release.yml` when a `vX.Y.Z` tag is pushed. The package name changes from `georg-ds`, so imports become `@shipibo-studio/georg-ds/georg.css` and `@shipibo-studio/georg-ds/tailwind.css`, and consumers need an `.npmrc` for the scope plus a `read:packages` token (see the README). Consumer impact: **georg-mail** can replace its vendored copy and `pnpm ds:sync` with the package, adding the `.npmrc` and `packages: read` in CI. **georg-app** has no code yet; its `docs/design-system.md` should use the new name instead of `georg-ds@github:…#v0.1.0`.
- All documentation, code comments and identifiers are now in English.
- Accent display names in `georgTheme.ACCENTS` are now English (`Purple`, `Fuchsia`, `Green`, `Blue`, `Orange`).
- The demo UI is now in English.
- **Repository layout:** the design system files moved to `src/` (`src/georg.css`, `src/georg-theme.js`, `src/fonts.css`, `src/tailwind.css`) and the README became an overview that links to `docs/`. The package exports keep their names, so `@import "georg-ds/georg.css"` and `georg-ds/tailwind.css` still resolve. Consumer impact: **georg-mail**'s `scripts/sync-georg-ds.mjs` reads `src/<file>` and falls back to the root for older refs (done in georg-mail f3c1798). **georg-app** has no code yet; when it copies `georg-theme.js` to `public/`, the source is now `node_modules/georg-ds/src/georg-theme.js`.
- `docs/patterns.md` and the demo now match the shipped georg-mail dashboard: toasts sit bottom-center in a polite live region, and the new-item highlight fades over 2.2 s instead of 1.8 s. The Manual refresh pattern is documented. Consumer impact: **georg-mail** already works this way; **georg-app** should follow it.
- Tests moved from `tests/` to `test/unit/` and `test/e2e/`. `npm test` now runs both suites and needs `npm install` plus `npx playwright install chromium` first.

### Fixed

- `--text-3` in light mode darkened to `#6b6b74`: it was 4.46:1 on `--bg-hover`, below WCAG AA.
- `georgTheme.setAccent()` accepted inherited object keys such as `"constructor"` or `"toString"`, persisting them and writing them to `data-accent`. It now throws `Unknown accent` for them like any other unknown value. Consumer impact: none for georg-mail or georg-app, which do not call `setAccent` with arbitrary input yet.

## [0.1.0] - 2026-10-16

### Added

- Light and dark color tokens with five user-selectable accents (purple by default, fuchsia, green, blue, orange), verified for WCAG AA contrast.
- Typography: Stack Sans Notch (display), Geist and Geist Mono.
- Motion primitives (`.fade-in`, `.pop`, `.skeleton`, View Transitions) that respect `prefers-reduced-motion`.
- `georg-theme.js`: system theme by default, persistence, cross-tab sync and the `window.georgTheme` API.
- Bridge for Tailwind CSS v4 and shadcn/ui.
- Interactive demo based on the georg-mail dashboard.

[Unreleased]: https://github.com/shipibo-studio/georg-ds/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/shipibo-studio/georg-ds/compare/v0.2.2...v0.3.0
[0.2.2]: https://github.com/shipibo-studio/georg-ds/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/shipibo-studio/georg-ds/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/shipibo-studio/georg-ds/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/shipibo-studio/georg-ds/releases/tag/v0.1.0
