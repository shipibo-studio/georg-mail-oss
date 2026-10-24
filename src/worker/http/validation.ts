import { zValidator } from "@hono/zod-validator";
import type { ValidationTargets } from "hono";
import type { z } from "zod";
import { ApiError } from "../errors";

/** zod validation that answers with the API's error format instead of Hono's default. */
export function validate<Target extends keyof ValidationTargets, Schema extends z.ZodType>(
  target: Target,
  schema: Schema,
) {
  return zValidator(target, schema, (result) => {
    if (!result.success) {
      throw new ApiError("validation_failed", "The request is invalid.", {
        details: result.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
      });
    }
  });
}
