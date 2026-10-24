import { z } from "zod";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "../config";
import { ApiError } from "../errors";

/** Keyset cursor over (timestamp, id): stable under inserts, unlike offsets. */
export interface Cursor {
  timestamp: number;
  id: string;
}

export function encodeCursor(cursor: Cursor): string {
  return btoa(`${cursor.timestamp}:${cursor.id}`).replace(/=+$/, "");
}

export function decodeCursor(value: string): Cursor {
  try {
    const [timestamp, id] = atob(value).split(":");
    const parsedTimestamp = Number(timestamp);
    if (!id || !/^[a-z]{3}_[0-9a-z]{20}$/.test(id) || !Number.isSafeInteger(parsedTimestamp)) throw new Error();
    return { timestamp: parsedTimestamp, id };
  } catch {
    throw new ApiError("validation_failed", "Invalid pagination cursor.", {
      hint: "Use the `nextCursor` value returned by the previous page, unchanged.",
    });
  }
}

export const pageQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  cursor: z.string().max(200).optional(),
});
