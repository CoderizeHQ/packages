/** Calendar days and wall-clock times in a named time zone. Every function defaults to America/Detroit. */

/** A Date, a millisecond timestamp, or an ISO string that names its offset (`Z`, `-05:00`). */
export type Instant = Date | number | string

/** `YYYY-MM-DD`. */
export type CalendarDay = string

export type DateStyle = 'full' | 'long' | 'medium' | 'short'

export interface WallTimeParts {
  year: number
  /** 1-12 */
  month: number
  day: number
  hour?: number
  minute?: number
  second?: number
}

export interface ZonedParts {
  year: number
  /** 1-12 */
  month: number
  day: number
  /** 0-23 */
  hour: number
  minute: number
  second: number
  /** 0 = Sunday ... 6 = Saturday */
  weekday: number
}

export declare const DEFAULT_TIME_ZONE: 'America/Detroit'

/** What a clock in `timeZone` reads at an instant. */
export declare function zonedParts(instant: Instant, timeZone?: string): ZonedParts

/** The calendar day of an instant in `timeZone`. A `YYYY-MM-DD` string comes back unchanged. */
export declare function calendarDay(value: Instant, timeZone?: string): CalendarDay

/** Today in `timeZone`, as `YYYY-MM-DD`. */
export declare function todayIn(timeZone?: string, now?: Date | number): CalendarDay

/** The day a date-only column holds (Prisma returns `@db.Date` as midnight UTC). */
export declare function utcDay(value: Date | string): CalendarDay

/** A `YYYY-MM-DD` day moved by whole calendar days. */
export declare function addDays(day: CalendarDay, days: number): CalendarDay

/**
 * The instant at which a clock in `timeZone` reads this wall time (`YYYY-MM-DDTHH:MM`, a `datetime-local` value).
 * A repeated time is the first of the two; a skipped one moves forward by the gap. null for an empty value.
 */
export declare function zonedWallTimeToUtc(wall: WallTimeParts, timeZone?: string): Date
export declare function zonedWallTimeToUtc(
  wall: string | WallTimeParts | null | undefined,
  timeZone?: string,
): Date | null

/** An instant as a clock in `timeZone` reads it, `YYYY-MM-DDTHH:MM` ('' for an empty value). */
export declare function utcToZonedWallTime(
  value: Instant | null | undefined,
  timeZone?: string,
  options?: { seconds?: boolean },
): string

/** The first instant of a day in `timeZone` and of the next day (exclusive). 23 or 25 hours apart on clock-change days. */
export declare function dayRangeUtc(day: CalendarDay, timeZone?: string): { start: Date; end: Date }

/** A date for display. A `YYYY-MM-DD` string prints as that day in any zone. */
export declare function formatDate(
  value: Instant | null | undefined,
  options?: { timeZone?: string; style?: DateStyle; locale?: string },
): string

/** A date and time for display, read in `timeZone`. */
export declare function formatDateTime(
  value: Instant | null | undefined,
  options?: { timeZone?: string; dateStyle?: DateStyle; timeStyle?: DateStyle; locale?: string },
): string

/** A time of day for display, read in `timeZone`. */
export declare function formatTime(
  value: Instant | null | undefined,
  options?: { timeZone?: string; style?: DateStyle; locale?: string },
): string

/** "3 hours ago", "in 2 days", "yesterday". A `YYYY-MM-DD` day counts calendar days from today in `timeZone`. */
export declare function formatRelative(
  value: Instant | null | undefined,
  options?: { now?: Date | number; timeZone?: string; locale?: string; numeric?: 'auto' | 'always' },
): string
