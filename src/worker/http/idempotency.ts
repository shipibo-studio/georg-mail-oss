// What a repeated Idempotency-Key gets: the first answer again, marked as a replay, or a 409 that
// says why not, with a code a client can act on (send a new key, or wait and retry with this one).
import type { Context } from "hono";
import { ApiError } from "../errors";

/** Set on an answer that repeats the first one for its Idempotency-Key, with nothing done again. */
export const IDEMPOTENT_REPLAYED_HEADER = "Idempotent-Replayed";

export function markReplayed(context: Context): void {
  context.header(IDEMPOTENT_REPLAYED_HEADER, "true");
}

export const keyReused = () =>
  new ApiError("idempotency_key_reused", "This Idempotency-Key was already used for a different request.", {
    hint: "Use a new Idempotency-Key for each new message, and the same one only to retry the same request.",
  });

export const keyInFlight = () =>
  new ApiError("idempotency_key_in_flight", "A request with this Idempotency-Key is still being processed.", {
    hint: "Retry with the same key in a moment to get its result.",
  });

/**
 * The earlier request with the same key, when its answer can be repeated: the same body, and
 * finished. Otherwise the 409 that says which of the two is missing.
 */
export function replayable<T extends { requestHash: string; completedAt: number | null }>(
  previous: T,
  requestHash: string,
): T {
  if (previous.requestHash !== requestHash) throw keyReused();
  if (previous.completedAt === null) throw keyInFlight();
  return previous;
}
