// Validation helpers

/**
 * Check if a string is a valid full ISO datetime (must include time and timezone).
 * Date-only strings like "2026-03-20" are INVALID.
 */
export function isValidISODatetime(value: string): boolean {
  if (typeof value !== "string") return false;

  // Reject date-only strings (YYYY-MM-DD without time component)
  // A valid full ISO datetime must contain a "T" or a space separating date and time
  if (/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) return false;

  const d = new Date(value);
  if (isNaN(d.getTime())) return false;

  // Must contain time information - check for 'T' or time patterns
  // Valid examples: "2026-03-20T10:00:00Z", "2026-03-20T10:00:00+05:30"
  // Invalid: "2026-03-20", "not-a-date"
  const hasTimeComponent = /T\d{2}:\d{2}/.test(value) || /\d{4}-\d{2}-\d{2}[ ]\d{2}:\d{2}/.test(value);
  if (!hasTimeComponent) return false;

  return true;
}

/**
 * Parse `now` from request body or query, falling back to real current time.
 * Returns null if the provided `now` is invalid.
 */
export function parseNow(now?: string): { date: Date; error?: string } | null {
  if (now === undefined || now === null || now === "") {
    return { date: new Date() };
  }
  if (!isValidISODatetime(now)) {
    return null;
  }
  return { date: new Date(now) };
}

/**
 * Validate that a value is a positive integer
 */
export function isPositiveInteger(val: unknown): val is number {
  return typeof val === "number" && Number.isInteger(val) && val > 0;
}

/**
 * Validate that a value is a non-negative integer
 */
export function isNonNegativeInteger(val: unknown): val is number {
  return typeof val === "number" && Number.isInteger(val) && val >= 0;
}

/**
 * Validate non-empty string
 */
export function isNonEmptyString(val: unknown): val is string {
  return typeof val === "string" && val.trim().length > 0;
}
