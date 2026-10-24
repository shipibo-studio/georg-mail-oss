// The dashboard is protected by Cloudflare Access (Google sign-in). Access puts a signed JWT in
// the Cf-Access-Jwt-Assertion header; the Worker verifies it itself instead of trusting that the
// edge rule is configured, then maps the verified email to an account through dashboard_members.
import { eq } from "drizzle-orm";
import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { createRemoteJWKSet, type JWTVerifyGetKey, jwtVerify } from "jose";
import { accounts, dashboardMembers, plans } from "../db/schema";
import { ApiError } from "../errors";
import type { MailEnv } from "../http/mail-env";

const ACCESS_JWT_HEADER = "Cf-Access-Jwt-Assertion";
// Access signs with RS256; pinning it refuses tokens that try another algorithm with the same keys.
const ACCESS_ALGORITHMS = ["RS256"];
/** State-changing dashboard requests must carry it: a cross-site form or link cannot add headers. */
export const DASHBOARD_REQUEST_HEADER = "X-Georg-Dashboard";
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// One key set per Access team, reused across requests in the same isolate (it caches the keys).
const keySets = new Map<string, JWTVerifyGetKey>();

function keySetFor(teamDomain: string): JWTVerifyGetKey {
  let keySet = keySets.get(teamDomain);
  if (!keySet) {
    keySet = createRemoteJWKSet(new URL("/cdn-cgi/access/certs", teamDomain));
    keySets.set(teamDomain, keySet);
  }
  return keySet;
}

/**
 * The Access issuer, exactly as it appears in the token's `iss` claim ("https://team.cloudflareaccess.com"),
 * whether the setting was written with or without the scheme or a trailing slash.
 */
export function accessIssuer(teamDomain: string): string {
  const value = teamDomain.trim();
  return new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`).origin;
}

async function verifiedEmail(token: string, teamDomain: string, audience: string): Promise<string> {
  try {
    const { payload } = await jwtVerify(token, keySetFor(teamDomain), {
      issuer: teamDomain,
      audience,
      algorithms: ACCESS_ALGORITHMS,
    });
    const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
    if (!email) throw new Error("no email claim");
    return email;
  } catch {
    throw new ApiError("unauthorized", "The dashboard session is invalid or expired.", {
      hint: "Sign in again through Cloudflare Access.",
    });
  }
}

/** Cross-site request forgery: the session is a cookie, so writes must prove they come from the app. */
export function assertSameOriginWrite(
  method: string,
  origin: string | undefined,
  marker: string | undefined,
  publicBaseUrl: string,
) {
  if (SAFE_METHODS.has(method)) return;
  if (marker !== "1" || origin !== new URL(publicBaseUrl).origin) {
    throw new ApiError("forbidden", "This request did not come from the dashboard.", {
      hint: `Send it from the dashboard with the ${DASHBOARD_REQUEST_HEADER}: 1 header.`,
    });
  }
}

/**
 * The email Cloudflare Access verified for this request, after checking that Access is configured
 * and that a write comes from the dashboard. It says who is signed in, not that they are a member.
 */
export async function accessIdentity(context: Context<MailEnv>): Promise<string> {
  const { ACCESS_TEAM_DOMAIN: configuredTeamDomain, ACCESS_AUD: configuredAudience } = context.env;
  const audience = configuredAudience?.trim();
  if (!configuredTeamDomain?.trim() || !audience) {
    throw new ApiError("unavailable", "The dashboard is not configured.", {
      hint: "Set ACCESS_TEAM_DOMAIN and ACCESS_AUD for the Cloudflare Access application.",
    });
  }
  assertSameOriginWrite(
    context.req.method,
    context.req.header("Origin"),
    context.req.header(DASHBOARD_REQUEST_HEADER),
    context.env.PUBLIC_BASE_URL,
  );
  const token = context.req.header(ACCESS_JWT_HEADER);
  if (!token) {
    throw new ApiError("unauthorized", "Sign in to open the dashboard.", {
      hint: "The dashboard is served behind Cloudflare Access.",
    });
  }
  return verifiedEmail(token, accessIssuer(configuredTeamDomain), audience);
}

export const requireDashboardSession = createMiddleware<MailEnv>(async (context, next) => {
  const email = await accessIdentity(context);

  const [member] = await context
    .get("db")
    .select({ account: accounts, plan: plans })
    .from(dashboardMembers)
    .innerJoin(accounts, eq(accounts.id, dashboardMembers.accountId))
    .innerJoin(plans, eq(plans.id, accounts.planId))
    .where(eq(dashboardMembers.email, email))
    .limit(1);
  if (!member) {
    throw new ApiError("forbidden", "This account has no access to the dashboard.", {
      hint: "Ask the owner to add your email to the dashboard members.",
    });
  }
  context.set("dashboard", { email, account: member.account, plan: member.plan });
  await next();
});
