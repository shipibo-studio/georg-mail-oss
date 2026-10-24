/** D1 reports constraint failures only through the error message, sometimes wrapped in `cause`. */
export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && /UNIQUE constraint failed/i.test(`${error.message} ${String(error.cause)}`);
}
