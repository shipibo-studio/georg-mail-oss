// The one error format of every edition: { error: { code, message, hint } }, with a Retry-After on
// 429. Unknown errors become a plain 500 and only their type is logged: query errors embed SQL
// parameters (addresses, filters) in their message, and request bodies may contain email content.
import type { Context } from "hono";
import { ApiError } from "../errors";
import { RETRY_AFTER_SECONDS } from "./client-limits";

export function toApiError(error: Error): ApiError {
  return error instanceof ApiError ? error : new ApiError("internal_error", "Something went wrong. Try again.");
}

export function errorResponse(error: Error, context: Context): Response {
  const apiError = toApiError(error);
  if (apiError.code === "rate_limited") context.header("Retry-After", String(RETRY_AFTER_SECONDS));
  if (!(error instanceof ApiError)) {
    const cause = error.cause instanceof Error ? error.cause.name : undefined;
    console.error("Unhandled error", { route: context.req.routePath, error: error.name, cause });
  }
  return context.json(apiError.toBody(), apiError.status);
}
