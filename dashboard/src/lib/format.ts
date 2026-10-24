import type { Locale } from "../i18n/translate";

const DAY_MS = 24 * 60 * 60 * 1000;

/** How times of day are written: 24-hour (14:05, the default) or 12-hour with AM/PM. */
export const CLOCKS = ["24h", "12h"] as const;
export type Clock = (typeof CLOCKS)[number];
export const DEFAULT_CLOCK: Clock = "24h";

// hourCycle, not hour12: hour12 false gives "24:05" after midnight in some locales.
const hourCycleOf = (clock: Clock) => (clock === "12h" ? "h12" : "h23");
const UNITS = ["B", "KB", "MB", "GB"] as const;
const BYTES_PER_UNIT = 1024;

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** Compact time for a list: "14:05" today, "Mon" this week, "12 Oct" this year, "12/10/25" before. */
export function formatListTime(iso: string, locale: Locale, clock: Clock = DEFAULT_CLOCK, now = new Date()): string {
  const date = new Date(iso);
  if (sameDay(date, now)) {
    return new Intl.DateTimeFormat(locale, {
      hour: clock === "12h" ? "numeric" : "2-digit",
      minute: "2-digit",
      hourCycle: hourCycleOf(clock),
    }).format(date);
  }
  if (now.getTime() - date.getTime() < 6 * DAY_MS && date < now) {
    return new Intl.DateTimeFormat(locale, { weekday: "short" }).format(date);
  }
  if (date.getFullYear() === now.getFullYear()) {
    return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }).format(date);
  }
  return new Intl.DateTimeFormat(locale, { dateStyle: "short" }).format(date);
}

export function formatFullDate(iso: string, locale: Locale, clock: Clock = DEFAULT_CLOCK): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    hourCycle: hourCycleOf(clock),
  }).format(new Date(iso));
}

/** A sample afternoon time in the given clock ("14:30", "2:30 PM"), to show the choice in Settings. */
export function sampleTime(locale: Locale, clock: Clock): string {
  return new Intl.DateTimeFormat(locale, { timeStyle: "short", hourCycle: hourCycleOf(clock) }).format(
    new Date(2026, 0, 1, 14, 30),
  );
}

export function formatBytes(bytes: number, locale: Locale): string {
  let value = Math.max(0, bytes);
  let unit = 0;
  while (value >= BYTES_PER_UNIT && unit < UNITS.length - 1) {
    value /= BYTES_PER_UNIT;
    unit += 1;
  }
  const digits = unit === 0 || value >= 10 ? 0 : 1;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(value)} ${UNITS[unit]}`;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["day", DAY_MS],
  ["hour", HOUR_MS],
  ["minute", MINUTE_MS],
  ["second", 1_000],
];

/** "3 minutes ago", "in 2 hours": the largest unit that fits. */
export function formatRelative(iso: string, locale: Locale, now = Date.now()): string {
  const difference = new Date(iso).getTime() - now;
  const format = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  for (const [unit, size] of RELATIVE_UNITS) {
    if (Math.abs(difference) >= size || unit === "second") return format.format(Math.round(difference / size), unit);
  }
  return format.format(0, "second");
}

/** Time left, compact: "47 min", "3 h 5 min", "6 d", "42 s". */
export function formatRemaining(milliseconds: number, locale: Locale): string {
  const number = (value: number, unit: "day" | "hour" | "minute" | "second") =>
    new Intl.NumberFormat(locale, { style: "unit", unit, unitDisplay: "narrow" }).format(value);
  if (milliseconds >= DAY_MS) return number(Math.floor(milliseconds / DAY_MS), "day");
  if (milliseconds >= HOUR_MS) {
    const minutes = Math.floor((milliseconds % HOUR_MS) / MINUTE_MS);
    const hours = number(Math.floor(milliseconds / HOUR_MS), "hour");
    return minutes ? `${hours} ${number(minutes, "minute")}` : hours;
  }
  if (milliseconds >= MINUTE_MS) return number(Math.floor(milliseconds / MINUTE_MS), "minute");
  return number(Math.max(0, Math.ceil(milliseconds / 1_000)), "second");
}

export type ExpiryLevel = "ok" | "warn" | "danger" | "expired";

/** georg-ds countdown colors: green, amber under 5 minutes, red under 1 minute. */
export function expiryLevel(milliseconds: number): ExpiryLevel {
  if (milliseconds <= 0) return "expired";
  if (milliseconds < MINUTE_MS) return "danger";
  if (milliseconds < 5 * MINUTE_MS) return "warn";
  return "ok";
}
