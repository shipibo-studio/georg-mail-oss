// Cloudflare Access for tests: one signing key per isolate (jose caches the team's key set, so every
// test file must serve the same one), tokens for any email, and dashboard requests that carry the
// session, the Origin and the CSRF header exactly as the browser app does.
import { env } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { exportJWK, generateKeyPair, type JWK, SignJWT } from "jose";
import { DASHBOARD_REQUEST_HEADER } from "../src/worker/dashboard/dashboard-session";
import { BASE_URL } from "./mail-helpers";

export const ACCESS_KEY_ID = "test-access-key";
export const ACCESS_CERTS_URL = `${env.ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`;
export const DASHBOARD_ORIGIN = new URL(env.PUBLIC_BASE_URL).origin;

const pair = await generateKeyPair("RS256", { extractable: true });
export const accessSigningKey: CryptoKey = pair.privateKey;
export const accessJwk: JWK = { ...(await exportJWK(pair.publicKey)), kid: ACCESS_KEY_ID, alg: "RS256", use: "sig" };

export function accessToken(
  email: string,
  options: { key?: CryptoKey; audience?: string; expiresAt?: string | number } = {},
): Promise<string> {
  return new SignJWT({ email })
    .setProtectedHeader({ alg: "RS256", kid: ACCESS_KEY_ID })
    .setIssuer(env.ACCESS_TEAM_DOMAIN)
    .setAudience(options.audience ?? env.ACCESS_AUD)
    .setIssuedAt()
    .setExpirationTime(options.expiresAt ?? "10m")
    .sign(options.key ?? accessSigningKey);
}

export interface DashboardRequest {
  method?: string;
  body?: unknown;
  token?: string | null;
  headers?: Record<string, string>;
  /** Adds the Origin and marker headers that the dashboard sends with every write. */
  sameOrigin?: boolean;
}

export async function dashboardFetch(member: string, path: string, request: DashboardRequest = {}): Promise<Response> {
  const method = request.method ?? "GET";
  const headers = new Headers(request.headers);
  const token = request.token === undefined ? await accessToken(member) : request.token;
  if (token) headers.set("Cf-Access-Jwt-Assertion", token);
  if (method !== "GET" && request.sameOrigin !== false) {
    headers.set("Origin", DASHBOARD_ORIGIN);
    headers.set(DASHBOARD_REQUEST_HEADER, "1");
  }
  if (request.body !== undefined) headers.set("Content-Type", "application/json");
  return exports.default.fetch(
    new Request(`${BASE_URL}/dashboard/api${path}`, {
      method,
      headers,
      body: request.body === undefined ? undefined : JSON.stringify(request.body),
    }),
  );
}
