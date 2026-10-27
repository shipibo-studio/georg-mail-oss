import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { DASHBOARD_CONTENT_SECURITY_POLICY } from "../src/worker/dashboard/content-security-policy";
import { mockApi } from "./mock/mock-api";

// `pnpm dashboard:mock` serves an in-memory API instead of proxying to `pnpm dev`.
const useMockApi = process.env.GEORG_MOCK_API === "1";

/** The georg mail favicon and app icons, from georg-ds's brand files (never redrawn here). */
const BRAND_FILES = ["mail-favicon.svg", "mail-favicon-32.png", "mail-apple-touch-icon.png"];

/**
 * Files served from public/ as they are, copied from the georg-ds package whenever Vite starts so
 * they always match the installed version: georg-theme.js, which must run as a blocking classic
 * script before the bundle (theme and accent before the first paint), and the brand icons.
 */
function georgDesignSystemFiles(): Plugin {
  const resolve = (file: string) => createRequire(import.meta.url).resolve(`@shipibo-studio/georg-ds/${file}`);
  const publicDir = path.join(import.meta.dirname, "public");
  return {
    name: "georg-ds-files",
    config: () => {
      copyFileSync(resolve("georg-theme.js"), path.join(publicDir, "georg-theme.js"));
      mkdirSync(path.join(publicDir, "brand"), { recursive: true });
      for (const file of BRAND_FILES) copyFileSync(resolve(`brand/${file}`), path.join(publicDir, "brand", file));
    },
  };
}

// The app is served by the Worker under /dashboard (see src/worker/dashboard/dashboard-assets.ts).
export default defineConfig({
  root: import.meta.dirname,
  base: "/dashboard/",
  plugins: [georgDesignSystemFiles(), react(), tailwindcss(), ...(useMockApi ? [mockApi()] : [])],
  build: {
    outDir: "../dist/dashboard",
    emptyOutDir: true,
    // No inline scripts or styles: the Content-Security-Policy allows scripts from 'self' only.
    assetsInlineLimit: 0,
    modulePreload: { polyfill: false },
    sourcemap: false,
  },
  // `pnpm dashboard:preview` checks the production build under the Worker's real policy.
  preview: { headers: { "Content-Security-Policy": DASHBOARD_CONTENT_SECURITY_POLICY } },
  server: {
    // `pnpm dashboard:dev` talks to `pnpm dev` for the API.
    proxy: useMockApi ? undefined : { "/dashboard/api": "http://localhost:8787" },
  },
});
