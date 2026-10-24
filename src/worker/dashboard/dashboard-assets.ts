// Serves the dashboard app (built by Vite into dist/dashboard) from Workers Assets. Cloudflare
// Access guards /dashboard at the edge; the shell itself holds no data, the API checks the session.
// Every response carries a strict Content-Security-Policy: the app shows email HTML, which is
// untrusted, inside a sandboxed iframe that inherits this policy.
import { Hono } from "hono";
import { notFound } from "../errors";
import type { MailEnv } from "../http/mail-env";
import { DASHBOARD_CONTENT_SECURITY_POLICY } from "./content-security-policy";

export { DASHBOARD_CONTENT_SECURITY_POLICY };

export const DASHBOARD_BASE_PATH = "/dashboard";
const INDEX_PATH = `${DASHBOARD_BASE_PATH}/index.html`;
// Vite puts content-hashed files here, so they never change once published.
const HASHED_ASSETS_PREFIX = `${DASHBOARD_BASE_PATH}/assets/`;
const IMMUTABLE_CACHE = "public, max-age=31536000, immutable";
const REVALIDATE_CACHE = "no-cache";
const API_PREFIX = `${DASHBOARD_BASE_PATH}/api/`;

const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy": DASHBOARD_CONTENT_SECURITY_POLICY,
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
};

/** A path inside the app (a folder, a message, or the root), not a file: answered with the app shell. */
function isAppRoute(pathname: string): boolean {
  const lastSegment = pathname.slice(pathname.lastIndexOf("/") + 1);
  return !lastSegment.includes(".");
}

function withDashboardHeaders(response: Response, pathname: string): Response {
  const secured = new Response(response.body, response);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) secured.headers.set(name, value);
  const immutable = response.ok && pathname.startsWith(HASHED_ASSETS_PREFIX);
  secured.headers.set("Cache-Control", immutable ? IMMUTABLE_CACHE : REVALIDATE_CACHE);
  return secured;
}

async function fetchAsset(assets: Fetcher, request: Request, pathname: string): Promise<Response> {
  const url = new URL(request.url);
  url.pathname = pathname;
  url.search = "";
  return assets.fetch(new Request(url, { method: request.method, headers: request.headers }));
}

export const dashboardAssets = new Hono<MailEnv>()
  .get("/", (context) => context.redirect(`${DASHBOARD_BASE_PATH}/`, 308))
  .get("/*", async (context) => {
    const { pathname } = new URL(context.req.url);
    // An unknown API route is an API error, never the app shell.
    if (pathname.startsWith(API_PREFIX)) throw notFound("Route");
    // App routes get the shell; the app reads the folder and message from the URL.
    const target = isAppRoute(pathname) ? INDEX_PATH : pathname;
    const response = await fetchAsset(context.env.ASSETS, context.req.raw, target);
    return withDashboardHeaders(response, target);
  });
