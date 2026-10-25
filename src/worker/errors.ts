import type { ContentfulStatusCode } from "hono/utils/http-status";
import { DOCS_URL } from "./docs-url";

export type ErrorCode =
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "validation_failed"
  | "conflict"
  | "idempotency_key_reused"
  | "idempotency_key_in_flight"
  | "plan_limit"
  | "payload_too_large"
  | "rate_limited"
  | "internal_error"
  | "unavailable";

const STATUS_BY_CODE: Record<ErrorCode, ContentfulStatusCode> = {
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  validation_failed: 400,
  conflict: 409,
  idempotency_key_reused: 409,
  idempotency_key_in_flight: 409,
  plan_limit: 403,
  payload_too_large: 413,
  rate_limited: 429,
  internal_error: 500,
  unavailable: 503,
};

/**
 * An error that is safe to show to API clients. Messages and hints are written for agents:
 * they say what went wrong and what to do next.
 */
export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly hint: string | undefined;
  readonly details: unknown;

  constructor(code: ErrorCode, message: string, options: { hint?: string; details?: unknown } = {}) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.hint = options.hint;
    this.details = options.details;
  }

  get status(): ContentfulStatusCode {
    return STATUS_BY_CODE[this.code];
  }

  toBody() {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.hint ? { hint: this.hint } : {}),
        ...(this.details === undefined ? {} : { details: this.details }),
        docsUrl: DOCS_URL,
      },
    };
  }
}

export const notFound = (resource: string) =>
  new ApiError("not_found", `${resource} not found.`, {
    hint: "Check the id. Expired or deleted resources are removed permanently.",
  });
