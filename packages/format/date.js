// Calendar days and wall-clock times in one named time zone, whatever zone the device or server
// runs in. The fleet's clients are in Michigan, so the zone defaults to America/Detroit.
//
// Three mistakes this module exists to stop:
// - "Today" from `toISOString().slice(0, 10)` is the UTC day, which is already tomorrow after
//   8 pm EDT (7 pm EST).
// - A day is not always 24 hours. On 2026-03-08 Detroit's day is 23 hours long and on
//   2026-11-01 it is 25, so "midnight + 24h" ends a day an hour early or late.
// - `new Date('2026-11-03T18:00')` reads the time in the browser's zone. An admin form in another
//   zone shifted a month of Xceptional Heroes events by 8 hours in August 2026.
//
// Every function takes the zone as a parameter; nothing reads the process's own zone.

export const DEFAULT_TIME_ZONE = 'America/Detroit'

const DAY_MS = 24 * 60 * 60 * 1000
const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const WALL_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/
// An ISO timestamp that names its offset. One without (2026-11-03T18:00) means a different
// instant in every zone, so it is refused rather than read in the process's zone.
const INSTANT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}(?::?\d{2})?)$/i
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const pad = (n, width = 2) => String(n).padStart(width, '0')

const cache = new Map()
function cached(key, make) {
  let value = cache.get(key)
  if (!value) {
    value = make()
    cache.set(key, value)
  }
  return value
}

function partsFormatter(timeZone) {
  return cached(`parts|${timeZone}`, () => {
    return new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      weekday: 'short',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    })
  })
}

function toInstant(value) {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new RangeError('Invalid Date')
    return value
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new RangeError(`Not a timestamp: ${value}`)
    return new Date(value)
  }
  if (typeof value === 'string') {
    if (!INSTANT_RE.test(value)) {
      throw new RangeError(
        `"${value}" is not an ISO timestamp with an offset. A wall-clock time needs zonedWallTimeToUtc; a calendar day is a YYYY-MM-DD string.`
      )
    }
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) throw new RangeError(`Invalid timestamp: "${value}"`)
    return date
  }
  throw new TypeError(`Expected a Date, a timestamp or an ISO string, got ${value === null ? 'null' : typeof value}`)
}

function checkDay(year, month, day) {
  const at = new Date(Date.UTC(year, month - 1, day))
  if (at.getUTCFullYear() !== year || at.getUTCMonth() !== month - 1 || at.getUTCDate() !== day) {
    throw new RangeError(`Not a calendar day: ${year}-${pad(month)}-${pad(day)}`)
  }
}

function parseDay(day) {
  const match = typeof day === 'string' ? DAY_RE.exec(day) : null
  if (!match) throw new RangeError(`Expected a YYYY-MM-DD day, got ${JSON.stringify(day)}`)
  const [year, month, date] = match.slice(1).map(Number)
  checkDay(year, month, date)
  return { year, month, day: date }
}

const isDay = (value) => typeof value === 'string' && DAY_RE.test(value)

/**
 * What a clock in `timeZone` reads at an instant.
 * @param {Date | number | string} instant
 * @param {string} [timeZone]
 */
export function zonedParts(instant, timeZone = DEFAULT_TIME_ZONE) {
  const out = {}
  for (const p of partsFormatter(timeZone).formatToParts(toInstant(instant))) {
    if (p.type === 'weekday') out.weekday = WEEKDAYS.indexOf(p.value)
    else if (p.type !== 'literal') out[p.type] = Number(p.value)
  }
  // Some runtimes still print midnight as 24 with hourCycle h23.
  if (out.hour === 24) out.hour = 0
  return out
}

// How far the zone's clock is ahead of UTC at `ms`, in milliseconds (negative west of UTC).
function offsetAt(ms, timeZone) {
  const p = zonedParts(ms, timeZone)
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000
}

/**
 * The calendar day of an instant in `timeZone`, as YYYY-MM-DD. A YYYY-MM-DD string is already a
 * day and comes back unchanged.
 * @param {Date | number | string} value
 * @param {string} [timeZone]
 * @returns {string}
 */
export function calendarDay(value, timeZone = DEFAULT_TIME_ZONE) {
  if (isDay(value)) {
    parseDay(value)
    return value
  }
  const p = zonedParts(value, timeZone)
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}`
}

/**
 * Today in `timeZone`, as YYYY-MM-DD.
 * @param {string} [timeZone]
 * @param {Date | number} [now]
 * @returns {string}
 */
export function todayIn(timeZone = DEFAULT_TIME_ZONE, now = new Date()) {
  return calendarDay(now, timeZone)
}

/**
 * The YYYY-MM-DD a date-only database column holds. Prisma returns a `@db.Date` as midnight UTC on
 * that day, which is the evening before in Michigan, so read it in UTC, never in a local zone.
 * @param {Date | string} value
 * @returns {string}
 */
export function utcDay(value) {
  if (isDay(value)) return calendarDay(value)
  return calendarDay(value, 'UTC')
}

/**
 * A YYYY-MM-DD day moved by whole calendar days.
 * @param {string} day
 * @param {number} days
 * @returns {string}
 */
export function addDays(day, days) {
  if (!Number.isInteger(days)) throw new RangeError(`days must be a whole number, got ${days}`)
  const { year, month, day: date } = parseDay(day)
  const at = new Date(Date.UTC(year, month - 1, date + days))
  return `${pad(at.getUTCFullYear(), 4)}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())}`
}

/**
 * The instant at which a clock in `timeZone` reads this wall time: what an admin typed into a
 * `datetime-local` input, read as Michigan time whatever zone the browser is in.
 *
 * A time that happens twice (01:30 on the fall-back night) is the first of the two. A time that
 * never happens (02:30 on the spring-forward night) moves forward by the gap, to 03:30. These are
 * the rules `Temporal` calls "compatible".
 *
 * @param {string | { year: number, month: number, day: number, hour?: number, minute?: number, second?: number } | null | undefined} wall
 *   `YYYY-MM-DDTHH:MM`, `YYYY-MM-DDTHH:MM:SS`, `YYYY-MM-DD` (midnight), or the parts.
 * @param {string} [timeZone]
 * @returns {Date | null} null for an empty value
 */
export function zonedWallTimeToUtc(wall, timeZone = DEFAULT_TIME_ZONE) {
  if (wall == null || wall === '') return null
  let parts
  if (typeof wall === 'string') {
    const match = WALL_RE.exec(wall.trim())
    if (!match) throw new RangeError(`Expected YYYY-MM-DDTHH:MM, got ${JSON.stringify(wall)}`)
    const [year, month, day, hour = 0, minute = 0, second = 0] = match
      .slice(1)
      .map((v) => (v == null ? undefined : Number(v)))
    parts = { year, month, day, hour, minute, second }
  } else {
    parts = { hour: 0, minute: 0, second: 0, ...wall }
  }
  const { year, month, day, hour, minute, second } = parts
  for (const [name, v] of Object.entries({ year, month, day, hour, minute, second })) {
    if (!Number.isInteger(v)) throw new RangeError(`${name} must be a whole number, got ${v}`)
  }
  checkDay(year, month, day)
  if (hour > 23 || minute > 59 || second > 59 || hour < 0 || minute < 0 || second < 0) {
    throw new RangeError(`Not a time of day: ${pad(hour)}:${pad(minute)}:${pad(second)}`)
  }

  const target = Date.UTC(year, month - 1, day, hour, minute, second)
  // The zone's offset a day either side covers both readings around a clock change.
  const earlier = target - offsetAt(target - DAY_MS, timeZone)
  const later = target - offsetAt(target + DAY_MS, timeZone)
  const readsTarget = [earlier, later].filter((t) => offsetAt(t, timeZone) === target - t)
  if (readsTarget.length > 0) return new Date(Math.min(...readsTarget))
  // In the spring-forward gap: keep the offset from before the change, which lands the gap's
  // length later on the clock.
  return new Date(earlier)
}

/**
 * An instant as a clock in `timeZone` reads it, as `YYYY-MM-DDTHH:MM` (a `datetime-local`
 * value), so an edit form shows Michigan time in any browser.
 * @param {Date | number | string | null | undefined} value
 * @param {string} [timeZone]
 * @param {{ seconds?: boolean }} [options] seconds: true adds `:SS`
 * @returns {string} '' for an empty value
 */
export function utcToZonedWallTime(value, timeZone = DEFAULT_TIME_ZONE, { seconds = false } = {}) {
  if (value == null || value === '') return ''
  const p = zonedParts(value, timeZone)
  const hm = `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`
  return seconds ? `${hm}:${pad(p.second)}` : hm
}

/**
 * The instants that bound a calendar day in `timeZone`: `start` is its first instant and `end` the
 * next day's first instant (exclusive), so `start <= t < end`. The span is 23 or 25 hours on the
 * days the clocks change.
 * @param {string} day YYYY-MM-DD
 * @param {string} [timeZone]
 * @returns {{ start: Date, end: Date }}
 */
export function dayRangeUtc(day, timeZone = DEFAULT_TIME_ZONE) {
  parseDay(day)
  return {
    start: zonedWallTimeToUtc(`${day}T00:00`, timeZone),
    end: zonedWallTimeToUtc(`${addDays(day, 1)}T00:00`, timeZone)
  }
}

// --- Display -------------------------------------------------------------------------------

// Some ICU versions put a narrow no-break space before AM/PM and others a plain one, so an Astro
// build and the browser that hydrates it could disagree. Output always uses plain spaces.
const plainSpaces = (s) => s.replace(/\s/g, ' ')

function format(locale, options, at) {
  const f = cached(`fmt|${locale}|${JSON.stringify(options)}`, () => new Intl.DateTimeFormat(locale, options))
  return plainSpaces(f.format(at))
}

/**
 * A date for display. A YYYY-MM-DD string is a calendar day and prints as that day in any zone;
 * an instant prints as its day in `timeZone`.
 * @param {Date | number | string | null | undefined} value
 * @param {{ timeZone?: string, style?: 'full' | 'long' | 'medium' | 'short', locale?: string }} [options]
 * @returns {string} '' for an empty value
 */
export function formatDate(value, { timeZone = DEFAULT_TIME_ZONE, style = 'medium', locale = 'en-US' } = {}) {
  if (value == null || value === '') return ''
  if (isDay(value)) {
    const { year, month, day } = parseDay(value)
    return format(locale, { dateStyle: style, timeZone: 'UTC' }, Date.UTC(year, month - 1, day, 12))
  }
  return format(locale, { dateStyle: style, timeZone }, toInstant(value))
}

/**
 * A date and time for display, read in `timeZone`. A `timeStyle` of 'long' or 'full' adds the
 * zone (EST, EDT).
 * @param {Date | number | string | null | undefined} value an instant, never a bare day
 * @param {{ timeZone?: string, dateStyle?: 'full' | 'long' | 'medium' | 'short', timeStyle?: 'full' | 'long' | 'medium' | 'short', locale?: string }} [options]
 * @returns {string} '' for an empty value
 */
export function formatDateTime(
  value,
  { timeZone = DEFAULT_TIME_ZONE, dateStyle = 'medium', timeStyle = 'short', locale = 'en-US' } = {}
) {
  if (value == null || value === '') return ''
  return format(locale, { dateStyle, timeStyle, timeZone }, toInstant(value))
}

/**
 * A time of day for display, read in `timeZone`.
 * @param {Date | number | string | null | undefined} value an instant, never a bare day
 * @param {{ timeZone?: string, style?: 'full' | 'long' | 'medium' | 'short', locale?: string }} [options]
 * @returns {string} '' for an empty value
 */
export function formatTime(value, { timeZone = DEFAULT_TIME_ZONE, style = 'short', locale = 'en-US' } = {}) {
  if (value == null || value === '') return ''
  return format(locale, { timeStyle: style, timeZone }, toInstant(value))
}

const UNITS = [
  ['second', 1000, 60],
  ['minute', 60 * 1000, 60],
  ['hour', 60 * 60 * 1000, 24],
  ['day', DAY_MS, 7],
  ['week', 7 * DAY_MS, 30 / 7],
  ['month', (365.25 / 12) * DAY_MS, 12],
  ['year', 365.25 * DAY_MS, Infinity]
]

/**
 * How far away a moment is, in words: "3 hours ago", "in 2 days", "yesterday". An instant is
 * measured in elapsed time from `now`. A YYYY-MM-DD day is counted in calendar days from today in
 * `timeZone`, so yesterday's date reads "yesterday" at any hour.
 * @param {Date | number | string | null | undefined} value
 * @param {{ now?: Date | number, timeZone?: string, locale?: string, numeric?: 'auto' | 'always' }} [options]
 * @returns {string} '' for an empty value
 */
export function formatRelative(
  value,
  { now = new Date(), timeZone = DEFAULT_TIME_ZONE, locale = 'en-US', numeric = 'auto' } = {}
) {
  if (value == null || value === '') return ''
  const rtf = cached(`rel|${locale}|${numeric}`, () => new Intl.RelativeTimeFormat(locale, { numeric }))
  let diff
  let first = 0
  if (isDay(value)) {
    const a = parseDay(value)
    const b = parseDay(todayIn(timeZone, now))
    diff = Date.UTC(a.year, a.month - 1, a.day) - Date.UTC(b.year, b.month - 1, b.day)
    first = 3 // start at days
  } else {
    diff = toInstant(value).getTime() - toInstant(now).getTime()
  }
  for (let i = first; i < UNITS.length; i++) {
    const [unit, ms, max] = UNITS[i]
    const amount = diff / ms
    if (Math.abs(amount) < max || i === UNITS.length - 1) return plainSpaces(rtf.format(Math.round(amount) || 0, unit))
  }
  return ''
}
