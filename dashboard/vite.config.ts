import { copyFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { DASHBOARD_CONTENT_SECURITY_POLICY } from "../src/worker/dashboard/content-security-policy";
import { mockApi } from "./mock/mock-api";

// `pnpm dashboard:mock` serves an in-memory API instead of proxying to `pnpm dev`.
const useMockApi = process.env.GEORG_MOCK_API === "1";

/**
 * georg-theme.js must run as a blocking classic script before the bundle (theme and accent before
 * the first paint), so it is served from public/ instead of bundled. It is copied from the georg-ds
 * package whenever Vite starts, so it always matches the installed version.
 */
function georgThemeScript(): Plugin {
  const source = createRequire(import.meta.url).resolve("@shipibo-studio/georg-ds/georg-theme.js");
  const target = path.join(import.meta.dirname, "public/georg-theme.js");
  return { name: "georg-theme-script", config: () => copyFileSync(source, target) };
}

// The app is served by the Worker under /dashboard (see src/worker/dashboard/dashboard-assets.ts).
export default defineConfig({
  root: import.meta.dirname,
  base: "/dashboard/",
  plugins: [georgThemeScript(), react(), tailwindcss(), ...(useMockApi ? [mockApi()] : [])],
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
