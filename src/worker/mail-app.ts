// The mail client on its own: the owner's mailbox behind Cloudflare Access, and nothing of the hosted
// product (no REST API, MCP, projects, keys, webhooks or notify hooks). This is the HTTP entry of the
// open-source edition (mail-index.ts), built from the same modules the hosted app uses.
import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { DASHBOARD_BASE_PATH, dashboardAssets } from "./dashboard/dashboard-assets";
import { requireDashboardSession } from "./dashboard/dashboard-session";
import { createMailboxRoutes } from "./dashboard/mailbox-routes";
import { setupRoutes } from "./dashboard/setup-routes";
import { updateRoutes } from "./dashboard/update-routes";
import { createDatabase } from "./db/client";
import { ApiError } from "./errors";
import { limitRequestBodies, rateLimitByClientIp } from "./http/client-limits";
import { errorResponse } from "./http/error-response";
import type { MailEnv } from "./http/mail-env";

const dashboardApi = new Hono<MailEnv>()
  .use(requireDashboardSession)
  .route("/mailbox", createMailboxRoutes())
  // Only here: the hosted product is deployed by its operator, not updated from its dashboard.
  .route("/updates", updateRoutes);

export const mailApp = new Hono<MailEnv>()
  .use(secureHeaders())
  .use(rateLimitByClientIp)
  .use(limitRequestBodies)
  .use(async (context, next) => {
    context.set("db", createDatabase(context.env.DB));
    await next();
  })
  // There is nothing at the root but the way to the mailbox.
  .get("/", (context) => context.redirect(`${DASHBOARD_BASE_PATH}/inbox`))
  // Before the mailbox API: first-run setup needs an Access identity, not a membership yet.
  .route(`${DASHBOARD_BASE_PATH}/api/setup`, setupRoutes)
  .route(`${DASHBOARD_BASE_PATH}/api`, dashboardApi)
  .route(DASHBOARD_BASE_PATH, dashboardAssets)
  .notFound((context) => {
    const error = new ApiError("not_found", "Route not found.", {
      hint: `The mail client lives at ${DASHBOARD_BASE_PATH}.`,
    });
    return context.json(error.toBody(), error.status);
  })
  .onError(errorResponse);
