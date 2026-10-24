// Request limits every edition applies before anything else: per client IP, and on body size. They
// keep unauthenticated floods and oversized bodies from costing CPU, storage or the request quota.
import { bodyLimit } from "hono/body-limit";
import { createMiddleware } from "hono/factory";
import { MAX_REQUEST_BODY_BYTES, PERSONAL_ATTACHMENTS_MAX_BYTES } from "../config";
import { IMPORT_MAX_MESSAGE_BYTES, PERSONAL_IMPORT_PATH } from "../dashboard/mail-import";
import { PERSONAL_UPLOAD_PATH } from "../dashboard/mail-uploads";
import { ApiError } from "../errors";

/** Seconds a client should wait after a 429; every limiter counts per 60-second window. */
export const RETRY_AFTER_SECONDS = 60;

/**
 * Per-client-IP limit that runs before authentication, so unauthenticated floods and public pages
 * cannot exhaust the Worker's request quota. Cloudflare sets CF-Connecting-IP on every request it
 * proxies; without it (local tests) there is no IP to count.
 */
export const rateLimitByClientIp = createMiddleware<{ Bindings: Env }>(async (context, next) => {
  const ip = context.req.header("CF-Connecting-IP");
  if (ip) {
    const { success } = await context.env.IP_RATE_LIMITER.limit({ key: ip });
    if (!success) {
      throw new ApiError("rate_limited", "Too many requests from this address.", {
        hint: "Slow down and retry in a minute.",
      });
    }
  }
  await next();
});

const jsonBodyLimit = bodyLimit({
  maxSize: MAX_REQUEST_BODY_BYTES,
  onError: () => {
    throw new ApiError("payload_too_large", `Request bodies are limited to ${MAX_REQUEST_BODY_BYTES} bytes.`);
  },
});
const uploadBodyLimit = bodyLimit({
  maxSize: PERSONAL_ATTACHMENTS_MAX_BYTES,
  onError: () => {
    throw new ApiError("payload_too_large", `Attachments are limited to ${PERSONAL_ATTACHMENTS_MAX_BYTES} bytes.`);
  },
});
const importBodyLimit = bodyLimit({
  maxSize: IMPORT_MAX_MESSAGE_BYTES,
  onError: () => {
    throw new ApiError("payload_too_large", `Imported messages are limited to ${IMPORT_MAX_MESSAGE_BYTES} bytes.`);
  },
});

/** Small JSON bodies everywhere, except the composer's file uploads and imported messages. */
export const limitRequestBodies = createMiddleware<{ Bindings: Env }>((context, next) => {
  if (context.req.path === PERSONAL_UPLOAD_PATH) return uploadBodyLimit(context, next);
  if (context.req.path === PERSONAL_IMPORT_PATH) return importBodyLimit(context, next);
  return jsonBodyLimit(context, next);
});
