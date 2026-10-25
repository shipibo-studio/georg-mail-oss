# Georg Design System

The **georg** design system: tokens, typography, color, motion, and interaction patterns for every georg interface (georg-mail is the first).

> **Version 0.8** (October 2026). It grew out of the georg-mail dashboard mockup, which serves as its reference demo: [`demo/dashboard.html`](demo/dashboard.html) (open it in a browser). Its consumers today are [georg-mail](https://github.com/shipibo-studio/georg-mail) and [georg-app](https://github.com/shipibo-studio/georg-app).

See [CHANGELOG.md](CHANGELOG.md).

## Principles

| Principle               | In practice                                                                                                              |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **Polished and subtle** | 1 px borders, soft shadows, warm neutrals, a single accent color. No flashy gradients or decoration that does not inform |
| **Precise**             | Technical data (codes, addresses, IDs) always in mono with tabular figures                                               |
| **Purposeful motion**   | Every animation communicates a state change. Nothing moves just for ornament                                             |
| **User-owned**          | System theme by default, selectable accent, persistent preferences                                                       |
| **Accessible**          | AA contrast, visible focus, keyboard navigation, and respect for `prefers-reduced-motion`                                |

## Repository layout

| Path | Contents |
| --- | --- |
| [`src/georg.css`](src/georg.css) | Tokens (light, dark, 5 accents), typographic base, and motion primitives |
| [`src/georg-theme.js`](src/georg-theme.js) | Theme and accent control: flash-free initialization, persistence, `window.georgTheme` API |
| [`src/components.css`](src/components.css) | Components: button, status, meter, progress, tabs, segmented control, switch, toast, tooltip, alert, field, checkbox and radio, file drop zone, chip and badge, empty state, keyboard shortcut, copy button (`g-` classes) |
| [`src/georg-tabs.js`](src/georg-tabs.js), [`src/georg-toast.js`](src/georg-toast.js), [`src/georg-tooltip.js`](src/georg-tooltip.js), [`src/georg-copy.js`](src/georg-copy.js), [`src/georg-file.js`](src/georg-file.js) | Opt-in behavior for tabs, toasts, tooltips, copy buttons and file drop zones (not needed with Radix) |
| [`src/georg-motion.mjs`](src/georg-motion.mjs), [`src/georg-sounds.mjs`](src/georg-sounds.mjs) | ES modules for React and bundlers: named springs, durations and swipe rule for Motion, and interface sound recipes for Web Audio. No side effects |
| [`src/fonts.css`](src/fonts.css) | Fonts from Google Fonts, for prototypes |
| [`src/tailwind.css`](src/tailwind.css) | Bridge for Tailwind CSS v4 and mapping to shadcn/ui variables |
| [`src/tokens.json`](src/tokens.json) | Every token resolved per theme and accent, for native apps (also attached to each GitHub release) |
| [`docs/`](docs/) | Guides: foundations, theming, patterns, components, accessibility, React implementation, brand identity |
| [`demo/dashboard.html`](demo/dashboard.html) | Interactive demo: theme, accents, and all interaction patterns |
| [`demo/components.html`](demo/components.html) | Every component in every state |
| [`demo/styleguide.html`](demo/styleguide.html) | Styleguide of every version: tokens, type, shape and motion, with the token changes and changelog between any two versions |
| [`test/`](test/) | Unit tests (`test/unit/`), end-to-end tests (`test/e2e/`) and shared helpers (`test/support/`) |

Only `src/` is shipped to consumers. The package exports keep short import paths (`@shipibo-studio/georg-ds/georg.css`, `@shipibo-studio/georg-ds/tailwind.css`), so consumers never write `src/`.

## Documentation

| Guide | Contents |
| --- | --- |
| [Foundations](docs/foundations.md) | Color, typography, icons, shape and elevation, motion |
| [Motion and sound](docs/motion.md) | Named springs, durations, gestures, every microinteraction with its reduced-motion fallback, and interface sounds |
| [Theme and accent](docs/theming.md) | `data-theme` attributes, the `georgTheme` API, React hook |
| [Interaction patterns](docs/patterns.md) | Copy, arrivals, live waiting, countdown, hold to delete, ⌘K and more; external content rules |
| [Components](docs/components.md) | The components georg-ds ships (markup, rules, Radix recipes, SwiftUI equivalents), the shadcn/ui bridge and allowed sources |
| [Accessibility](docs/accessibility.md) | Contrast, focus, keyboard and reduced motion requirements |
| [React implementation](docs/react-implementation.md) | How georg-mail builds georg-ds in React: motion values, patterns, responsive, tests |
| [Brand identity](docs/brand-identity.md) | Name, architecture, slogan, logo, voice and tone of the georg family |
| [Native and desktop apps](docs/native.md) | Units, fonts, icons (SF Symbols in native chrome), shared theme and accent, what stays native, desktop readings of the patterns |
| [Roadmap](docs/roadmap.md) | Gap analysis for the desktop and native apps, and the v0.3 plan |
| [Website direction](docs/website.md) | Design direction for `dasgeorg.cc`, based on talanoa.email |

## Installation

The package is **`@shipibo-studio/georg-ds`**, published privately to GitHub Packages from this repository. Installing it needs a token that can read the organization's packages.

**1. Point the scope to GitHub Packages** in the consumer's `.npmrc` (commit this file; it holds no secret):

```ini
@shipibo-studio:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}
```

**2. Provide the token:**

- **On your machine:** a classic personal access token with only the `read:packages` scope, exported as `NODE_AUTH_TOKEN` (for example from the macOS Keychain in your shell profile). GitHub Packages does not accept fine-grained tokens for npm.
- **In GitHub Actions:** `NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}` with `permissions: packages: read`. The first time, give the consumer repository read access in the package settings (*Package settings → Manage Actions access*).

**3. Install a pinned version:**

```bash
pnpm add @shipibo-studio/georg-ds@0.8.0

# During development, with the repository cloned next to the project
pnpm add @shipibo-studio/georg-ds@link:../georg-ds
```

### Prototype (static HTML)

```html
<head>
  <link rel="stylesheet" href="node_modules/@shipibo-studio/georg-ds/src/fonts.css">
  <link rel="stylesheet" href="node_modules/@shipibo-studio/georg-ds/src/georg.css">
  <link rel="stylesheet" href="node_modules/@shipibo-studio/georg-ds/src/components.css">
  <!-- No defer or async: resolves theme and accent before the first paint -->
  <script src="node_modules/@shipibo-studio/georg-ds/src/georg-theme.js"></script>
</head>
```

### App (Vite + React + Tailwind v4)

```bash
pnpm add @shipibo-studio/georg-ds@0.8.0
pnpm add @fontsource-variable/stack-sans-notch @fontsource-variable/geist @fontsource-variable/geist-mono @tabler/icons-react morphicons motion
```

```ts
// main.tsx
import "@fontsource-variable/stack-sans-notch";
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "./index.css";
```

```css
/* index.css */
@import "tailwindcss";
@import "@shipibo-studio/georg-ds/georg.css";
@import "@shipibo-studio/georg-ds/components.css";
@import "@shipibo-studio/georg-ds/tailwind.css";
```

With the `@fontsource-variable` packages, the families are named `"Stack Sans Notch Variable"`, `"Geist Variable"`, and `"Geist Mono Variable"`. Adjust `--font-display`, `--font`, and `--mono` when importing them.

`georg-theme.js` is included as a blocking `<script>` in the `<head>` of `index.html` (not as a bundle import), so the theme is applied before React paints. With Vite, copy `node_modules/@shipibo-studio/georg-ds/src/georg-theme.js` to `public/` and reference it as `<script src="/georg-theme.js"></script>`.

## Development

```bash
npm install                        # development dependencies (Playwright)
npx playwright install chromium    # browser for the end-to-end tests, once
npm test                           # unit tests with coverage, then end-to-end tests
open demo/dashboard.html           # visual check
open demo/styleguide.html          # tokens of every version, and what changed between them
open demo/components.html          # every component in every state
```

| Command | Purpose |
| --- | --- |
| `npm run test:unit` | Unit tests only: WCAG AA contrast for every theme and accent, `tokens.json` and the styleguide data, `georg-theme.js` against a simulated browser, and the component scripts in happy-dom |
| `npm run test:coverage` | Unit tests with a minimum of 85% line, branch and function coverage of `georg-theme.js` |
| `npm run generate` | Regenerates `src/tokens.json` and `demo/styleguide-data.js`; unit tests fail when they are stale |
| `npm run test:e2e` | End-to-end tests in Chromium through `demo/dashboard.html`, `demo/components.html` and `demo/styleguide.html`: first paint, persistence, cross-tab sync, keyboard, every component state, contrast, reduced motion |

No build step and no runtime dependencies. Requires Node.js 24 or later (see `.nvmrc`).

## Contributing

Read [`CONTRIBUTING.md`](CONTRIBUTING.md): English only, Clean Code, Conventional Commits, and a `CHANGELOG.md` entry for every user-visible change. Security reports: [`SECURITY.md`](SECURITY.md).

## License

[MIT](LICENSE). The license covers the code and tokens, not the "georg" name.
