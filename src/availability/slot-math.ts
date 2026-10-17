/**
 * Pure slot arithmetic for the services marketplace.
 *
 * Every time in this file is either a wall-clock string ("09:00") or an integer number of
 * minutes since midnight. No `Date` is ever built from a date string plus a time string
 * (`new Date('09:00')`, `new Date('2025-01-01T09:00')`), because those are parsed as UTC or
 * as an invalid local time depending on the runtime, which makes slots shift by an hour
 * across DST or between servers. Dates are only ever used for two things: deriving the
 * weekday (via `Date.UTC`, which is timezone-independent) and comparing "now" to a slot.
 *
 * The function is exported separately from the Nest service so it can be exercised with
 * plain assertions.
 */

export interface AvailabilitySlot {
  startTime: string;
  endTime: string;
  available: boolean;
}

export interface WeeklyWindowInput {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  isActive?: boolean;
}

export interface AvailabilityExceptionInput {
  isBlocked: boolean;
  startTime?: string | null;
  endTime?: string | null;
}

export interface ExistingBookingInput {
  startTime: string;
  endTime?: string | null;
  durationMinutes?: number | null;
  bufferMinutes?: number | null;
}

export interface BuildDaySlotsInput {
  /** YYYY-MM-DD */
  date: string;
  durationMinutes: number;
  bufferMinutes?: number;
  windows: WeeklyWindowInput[];
  exceptions?: AvailabilityExceptionInput[];
  bookings?: ExistingBookingInput[];
  /** Injectable clock so the "drop past slots" rule is testable. */
  now?: Date;
}

export const MINUTES_PER_DAY = 24 * 60;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** Strict calendar validation: `2025-02-30` is rejected, not silently rolled forward. */
export function isValidDateString(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = DATE_RE.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;

  const utc = new Date(Date.UTC(year, month - 1, day));
  return (
    utc.getUTCFullYear() === year && utc.getUTCMonth() === month - 1 && utc.getUTCDate() === day
  );
}

export function isValidTimeString(value: unknown): value is string {
  return typeof value === 'string' && TIME_RE.test(value);
}

/** Minutes since midnight, or NaN for anything that is not a valid HH:mm. */
export function timeToMinutes(value: string): number {
  const match = TIME_RE.exec(value || '');
  if (!match) return NaN;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function minutesToTime(total: number): string {
  const normalised =
    ((Math.round(total) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return `${pad(Math.floor(normalised / 60))}:${pad(normalised % 60)}`;
}

/** 0 = Sunday. `Date.UTC` keeps this independent of the server timezone. */
export function dayOfWeekForDate(date: string): number {
  const match = DATE_RE.exec(date);
  if (!match) return NaN;
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))).getUTCDay();
}

/** The server's local wall-clock date and minute-of-day, used to drop past slots. */
export function wallClockNow(now: Date = new Date()): { date: string; minutes: number } {
  return {
    date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    minutes: now.getHours() * 60 + now.getMinutes(),
  };
}

/**
 * One guard key per occupied minute: the booked minutes plus the service buffer that must
 * stay free afterwards. `Booking.slotKeys` carries these under a unique index, which is what
 * makes two overlapping bookings (not just two identical start times) impossible.
 */
export function buildSlotKeys(
  providerId: string,
  date: string,
  startTime: string,
  durationMinutes: number,
  bufferMinutes = 0,
): string[] {
  const start = timeToMinutes(startTime);
  if (!Number.isFinite(start) || !isValidDateString(date) || !providerId) return [];

  const span = Math.max(1, Math.round(durationMinutes || 0)) + Math.max(0, Math.round(bufferMinutes || 0));
  const keys: string[] = [];
  for (let minute = start; minute < Math.min(start + span, MINUTES_PER_DAY); minute++) {
    keys.push(`${providerId}:${date}:${minutesToTime(minute)}`);
  }
  return keys;
}

function mergeSortedRanges(ranges: Array<[number, number]>): Array<[number, number]> {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push([range[0], range[1]]);
  }
  return merged;
}

/**
 * Builds the bookable slots for one service on one date.
 *
 * - candidate starts come from the provider's active weekly windows for that weekday, stepped
 *   by the service duration, plus any date-specific opening override;
 * - a booking blocks `[start, end + bufferMinutes)`; the buffer is the booked service's own
 *   snapshot, because a 60-minute service with a 30-minute cleanup gap should not be treated
 *   like a 15-minute one just because the visitor is looking at a different service;
 * - blocked exceptions subtract ranges, and a whole-day exception (no times) returns no slots;
 * - slots whose start is already in the past are dropped entirely, while slots that exist but
 *   are taken stay in the list with `available: false` so the UI can grey them out.
 */
export function buildDaySlots(input: BuildDaySlotsInput): AvailabilitySlot[] {
  const { date } = input;
  if (!isValidDateString(date)) {
    throw new Error(`Invalid date "${date}" — expected YYYY-MM-DD`);
  }

  const durationMinutes = Math.round(Number(input.durationMinutes));
  if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
    throw new Error('durationMinutes must be a positive number');
  }

  const bufferMinutes = Math.max(0, Math.round(Number(input.bufferMinutes) || 0));
  const now = input.now || new Date();
  const { date: today, minutes: nowMinutes } = wallClockNow(now);
  const exceptions = input.exceptions || [];

  // A whole day off has no slot list at all; there is nothing for the UI to render.
  const wholeDayBlocked = exceptions.some(
    (exception) => exception.isBlocked && !exception.startTime && !exception.endTime,
  );
  if (wholeDayBlocked) return [];

  const dayOfWeek = dayOfWeekForDate(date);
  const windows: Array<{ start: number; end: number }> = [];

  for (const window of input.windows || []) {
    if (window.dayOfWeek !== dayOfWeek || window.isActive === false) continue;
    const start = timeToMinutes(window.startTime);
    const end = timeToMinutes(window.endTime);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    windows.push({ start, end });
  }

  // An unblocked exception with times opens an ad-hoc window for that exact date.
  for (const exception of exceptions) {
    if (exception.isBlocked) continue;
    const start = timeToMinutes(exception.startTime || '');
    const end = timeToMinutes(exception.endTime || '');
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
      windows.push({ start, end });
    }
  }

  const blockedRanges: Array<[number, number]> = [];

  for (const exception of exceptions) {
    if (!exception.isBlocked) continue;
    const start = timeToMinutes(exception.startTime || '');
    const end = timeToMinutes(exception.endTime || '');
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
      blockedRanges.push([start, end]);
    }
  }

  for (const booking of input.bookings || []) {
    const start = timeToMinutes(booking.startTime);
    if (!Number.isFinite(start)) continue;

    // The duration snapshot is authoritative; endTime is only a fallback for old rows.
    let end = NaN;
    if (Number.isFinite(booking.durationMinutes) && Number(booking.durationMinutes) > 0) {
      end = start + Number(booking.durationMinutes);
    } else if (isValidTimeString(booking.endTime)) {
      end = timeToMinutes(booking.endTime);
    }
    if (!Number.isFinite(end) || end <= start) continue;

    const bookingBuffer = Math.max(0, Math.round(Number(booking.bufferMinutes) || 0));
    blockedRanges.push([start, Math.min(end + bookingBuffer, MINUTES_PER_DAY)]);
  }

  const mergedBlocks = mergeSortedRanges(blockedRanges);

  // Deduplicate overlapping weekly windows: a provider with both 09:00-12:00 and 09:00-17:00
  // should still only see one 09:00 slot.
  const slotEnds = new Map<number, number>();
  for (const window of windows) {
    for (let start = window.start; start + durationMinutes <= window.end; start += durationMinutes) {
      if (!slotEnds.has(start)) slotEnds.set(start, start + durationMinutes);
    }
  }

  const starts = [...slotEnds.keys()].sort((a, b) => a - b);
  if (date < today) return [];

  const slots: AvailabilitySlot[] = [];
  for (const start of starts) {
    if (date === today && start <= nowMinutes) continue;

    const end = slotEnds.get(start) as number;
    const available = !mergedBlocks.some(([blockedStart, blockedEnd]) => start < blockedEnd && end > blockedStart);
    slots.push({
      startTime: minutesToTime(start),
      endTime: minutesToTime(end),
      available,
    });
  }

  return slots;
}
