import { describe, expect, it } from 'vitest'

import {
  addDays,
  calendarDay,
  dayRangeUtc,
  DEFAULT_TIME_ZONE,
  formatDate,
  formatDateTime,
  formatRelative,
  formatTime,
  todayIn,
  utcDay,
  utcToZonedWallTime,
  zonedParts,
  zonedWallTimeToUtc,
} from '@coderizehq/format/date'

const HOUR = 60 * 60 * 1000
const at = (iso) => new Date(iso)

// 9 pm in Detroit is already tomorrow in UTC: EST in November, EDT in July.
const NINE_PM_NOV = at('2026-11-04T02:00:00Z') // 2026-11-03 21:00 EST
const NINE_PM_JUL = at('2026-07-16T01:00:00Z') // 2026-07-15 21:00 EDT

describe('process time zone', () => {
  it('runs under the zone this project sets, so the suite proves nothing reads it', () => {
    const offsets = { UTC: 0, 'America/Detroit': 300, 'Asia/Kolkata': -330 }
    expect(Object.keys(offsets)).toContain(process.env.TZ)
    expect(new Date(2026, 0, 1).getTimezoneOffset()).toBe(offsets[process.env.TZ])
  })
})

describe('todayIn and calendarDay', () => {
  it('defaults to America/Detroit', () => {
    expect(DEFAULT_TIME_ZONE).toBe('America/Detroit')
  })

  it('keeps 9 pm Detroit on its own day, not the UTC day', () => {
    expect(todayIn(undefined, NINE_PM_NOV)).toBe('2026-11-03')
    expect(todayIn('America/Detroit', NINE_PM_JUL)).toBe('2026-07-15')
    expect(NINE_PM_NOV.toISOString().slice(0, 10)).toBe('2026-11-04')
  })

  it('takes the zone as a parameter', () => {
    expect(todayIn('UTC', NINE_PM_NOV)).toBe('2026-11-04')
    expect(todayIn('Asia/Kolkata', NINE_PM_NOV)).toBe('2026-11-04')
    expect(calendarDay('2026-11-03T18:29:00Z', 'Asia/Kolkata')).toBe('2026-11-03')
    expect(calendarDay('2026-11-03T18:30:00Z', 'Asia/Kolkata')).toBe('2026-11-04')
  })

  it('reads the last and first minute of a Detroit day either side of midnight', () => {
    expect(calendarDay(at('2026-11-04T04:59:00Z'))).toBe('2026-11-03')
    expect(calendarDay(at('2026-11-04T05:00:00Z'))).toBe('2026-11-04')
  })

  it('passes a YYYY-MM-DD day through untouched in any zone', () => {
    expect(calendarDay('2026-11-03')).toBe('2026-11-03')
    expect(calendarDay('2026-11-03', 'Asia/Kolkata')).toBe('2026-11-03')
  })

  it('refuses a timestamp with no offset, which means a different instant in every zone', () => {
    expect(() => calendarDay('2026-11-03T18:00')).toThrow(RangeError)
    expect(() => calendarDay('Nov 3 2026')).toThrow(RangeError)
    expect(() => calendarDay(new Date('nope'))).toThrow(RangeError)
    expect(() => calendarDay(null)).toThrow(TypeError)
  })

  it('refuses a day that is not on the calendar', () => {
    expect(() => calendarDay('2026-02-29')).toThrow(RangeError)
    expect(calendarDay('2028-02-29')).toBe('2028-02-29')
  })
})

describe('utcDay', () => {
  it('reads a Prisma @db.Date (midnight UTC) as its own day, not the Detroit evening before', () => {
    const due = at('2026-11-03T00:00:00Z')
    expect(utcDay(due)).toBe('2026-11-03')
    expect(calendarDay(due)).toBe('2026-11-02')
  })
})

describe('addDays', () => {
  it('moves across months, years, leap days and clock changes by calendar days', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29')
    expect(addDays('2026-03-07', 2)).toBe('2026-03-09')
    expect(() => addDays('2026-03-07', 1.5)).toThrow(RangeError)
  })
})

describe('dayRangeUtc', () => {
  const hours = ({ start, end }) => (end - start) / HOUR

  it('bounds an ordinary Detroit day at local midnights, 24 hours apart', () => {
    const range = dayRangeUtc('2026-11-03')
    expect(range.start.toISOString()).toBe('2026-11-03T05:00:00.000Z')
    expect(range.end.toISOString()).toBe('2026-11-04T05:00:00.000Z')
    expect(hours(range)).toBe(24)
  })

  it('puts 9 pm Detroit inside its own day', () => {
    const { start, end } = dayRangeUtc(todayIn(DEFAULT_TIME_ZONE, NINE_PM_NOV))
    expect(NINE_PM_NOV >= start && NINE_PM_NOV < end).toBe(true)
  })

  it('is 23 hours on spring-forward day, 2026-03-08', () => {
    const range = dayRangeUtc('2026-03-08')
    expect(range.start.toISOString()).toBe('2026-03-08T05:00:00.000Z')
    expect(range.end.toISOString()).toBe('2026-03-09T04:00:00.000Z')
    expect(hours(range)).toBe(23)
  })

  it('is 25 hours on fall-back day, 2026-11-01', () => {
    const range = dayRangeUtc('2026-11-01')
    expect(range.start.toISOString()).toBe('2026-11-01T04:00:00.000Z')
    expect(range.end.toISOString()).toBe('2026-11-02T05:00:00.000Z')
    expect(hours(range)).toBe(25)
  })

  it('ends exactly where the next day starts', () => {
    for (const day of ['2026-03-07', '2026-03-08', '2026-10-31', '2026-11-01', '2026-12-31']) {
      expect(dayRangeUtc(day).end).toEqual(dayRangeUtc(addDays(day, 1)).start)
    }
  })

  it('works in a zone with a half-hour offset and no daylight saving', () => {
    const range = dayRangeUtc('2026-11-03', 'Asia/Kolkata')
    expect(range.start.toISOString()).toBe('2026-11-02T18:30:00.000Z')
    expect(hours(range)).toBe(24)
  })
})

describe('zonedWallTimeToUtc and utcToZonedWallTime', () => {
  const utc = (wall, tz) => zonedWallTimeToUtc(wall, tz).toISOString()

  it('reads a typed time as Detroit time, whatever zone the process is in', () => {
    expect(utc('2026-11-03T21:00')).toBe('2026-11-04T02:00:00.000Z')
    expect(utc('2026-07-15T21:00')).toBe('2026-07-16T01:00:00.000Z')
    expect(utc('2026-07-15T21:00:30')).toBe('2026-07-16T01:00:30.000Z')
    expect(utc('2026-07-15')).toBe('2026-07-15T04:00:00.000Z')
    expect(utc({ year: 2026, month: 7, day: 15, hour: 21 })).toBe('2026-07-16T01:00:00.000Z')
  })

  it('shows an instant as the Detroit clock reads it', () => {
    expect(utcToZonedWallTime(NINE_PM_NOV)).toBe('2026-11-03T21:00')
    expect(utcToZonedWallTime('2026-07-16T01:00:30Z', undefined, { seconds: true })).toBe('2026-07-15T21:00:30')
    expect(utcToZonedWallTime(NINE_PM_NOV, 'Asia/Kolkata')).toBe('2026-11-04T07:30')
  })

  it('moves a time in the spring-forward gap forward by the gap (02:30 does not exist on 2026-03-08)', () => {
    expect(utc('2026-03-08T01:59')).toBe('2026-03-08T06:59:00.000Z')
    expect(utc('2026-03-08T02:00')).toBe('2026-03-08T07:00:00.000Z')
    expect(utc('2026-03-08T02:30')).toBe('2026-03-08T07:30:00.000Z')
    expect(utcToZonedWallTime(zonedWallTimeToUtc('2026-03-08T02:30'))).toBe('2026-03-08T03:30')
    expect(utc('2026-03-08T03:00')).toBe('2026-03-08T07:00:00.000Z')
  })

  it('takes the first of the two 01:30s on 2026-11-01', () => {
    expect(utc('2026-11-01T00:59')).toBe('2026-11-01T04:59:00.000Z')
    expect(utc('2026-11-01T01:30')).toBe('2026-11-01T05:30:00.000Z')
    expect(utc('2026-11-01T02:00')).toBe('2026-11-01T07:00:00.000Z')
    expect(utcToZonedWallTime('2026-11-01T05:30:00Z')).toBe('2026-11-01T01:30')
    expect(utcToZonedWallTime('2026-11-01T06:30:00Z')).toBe('2026-11-01T01:30')
  })

  // 35,040 Intl round trips: about 6 s on GitHub's hosted release runner, past the 5 s default.
  it('round-trips every quarter hour of 2026 outside the spring-forward gap', { timeout: 30_000 }, () => {
    const { start } = dayRangeUtc('2026-01-01')
    const { end } = dayRangeUtc('2026-12-31')
    for (let t = start.getTime(); t < end.getTime(); t += HOUR / 4) {
      const wall = utcToZonedWallTime(t)
      const back = zonedWallTimeToUtc(wall).getTime()
      // The second 01:xx on fall-back night maps to the first; every other time maps to itself.
      if (back !== t && t - back !== HOUR)
        throw new Error(`${new Date(t).toISOString()} came back as ${new Date(back).toISOString()}`)
      if (utcToZonedWallTime(back) !== wall)
        throw new Error(`${new Date(t).toISOString()}: ${wall} became ${utcToZonedWallTime(back)}`)
    }
  })

  it('returns null or empty for an empty value, as a cleared form field', () => {
    expect(zonedWallTimeToUtc('')).toBeNull()
    expect(zonedWallTimeToUtc(null)).toBeNull()
    expect(utcToZonedWallTime(null)).toBe('')
    expect(utcToZonedWallTime('')).toBe('')
  })

  it('refuses a malformed or impossible wall time', () => {
    expect(() => zonedWallTimeToUtc('2026-11-03 9pm')).toThrow(RangeError)
    expect(() => zonedWallTimeToUtc('2026-02-30T10:00')).toThrow(RangeError)
    expect(() => zonedWallTimeToUtc('2026-11-03T24:00')).toThrow(RangeError)
    expect(() => zonedWallTimeToUtc('2026-11-03T10:00', 'Mars/Olympus')).toThrow(RangeError)
  })
})

describe('zonedParts', () => {
  it('reads the clock and weekday in the zone', () => {
    expect(zonedParts(NINE_PM_NOV)).toEqual({
      year: 2026,
      month: 11,
      day: 3,
      hour: 21,
      minute: 0,
      second: 0,
      weekday: 2,
    })
    expect(zonedParts(at('2026-11-04T05:00:00Z')).hour).toBe(0)
  })
})

describe('formatters', () => {
  it('formats a calendar day as that day in every zone', () => {
    expect(formatDate('2026-11-03')).toBe('Nov 3, 2026')
    expect(formatDate('2026-11-03', { timeZone: 'Asia/Kolkata' })).toBe('Nov 3, 2026')
    expect(formatDate('2026-11-03', { style: 'full' })).toBe('Tuesday, November 3, 2026')
    expect(formatDate('2026-11-03', { style: 'short' })).toBe('11/3/26')
  })

  it('formats an instant as its day in the zone', () => {
    expect(formatDate(NINE_PM_NOV)).toBe('Nov 3, 2026')
    expect(formatDate(NINE_PM_NOV.toISOString())).toBe('Nov 3, 2026')
    expect(formatDate(NINE_PM_NOV, { timeZone: 'UTC' })).toBe('Nov 4, 2026')
  })

  it('formats a date and time and a time in the zone', () => {
    expect(formatDateTime(NINE_PM_NOV)).toBe('Nov 3, 2026, 9:00 PM')
    expect(formatDateTime(NINE_PM_JUL, { timeStyle: 'long' })).toBe('Jul 15, 2026, 9:00:00 PM EDT')
    expect(formatTime(NINE_PM_NOV)).toBe('9:00 PM')
    expect(formatTime(NINE_PM_NOV, { timeZone: 'UTC' })).toBe('2:00 AM')
  })

  it('formats the two 01:30s of fall-back night with their zones', () => {
    const opts = { timeStyle: 'long', dateStyle: 'short' }
    expect(formatDateTime('2026-11-01T05:30:00Z', opts)).toBe('11/1/26, 1:30:00 AM EDT')
    expect(formatDateTime('2026-11-01T06:30:00Z', opts)).toBe('11/1/26, 1:30:00 AM EST')
  })

  it('returns empty text for an empty value and refuses a bare day where a time is needed', () => {
    expect(formatDate(null)).toBe('')
    expect(formatDateTime(undefined)).toBe('')
    expect(formatTime('')).toBe('')
    expect(() => formatDateTime('2026-11-03')).toThrow(RangeError)
  })

  it('uses plain spaces, so a server render and the browser agree', () => {
    for (const s of [formatDateTime(NINE_PM_NOV), formatTime(NINE_PM_NOV), formatRelative(0, { now: 1000 })]) {
      expect(s).toMatch(/^[\x20-\x7e]*$/)
    }
  })
})

describe('formatRelative', () => {
  const now = NINE_PM_NOV

  it('measures an instant in elapsed time', () => {
    expect(formatRelative(now, { now })).toBe('now')
    expect(formatRelative(now.getTime() - 3 * HOUR, { now })).toBe('3 hours ago')
    expect(formatRelative(now.getTime() + 90 * 1000, { now })).toBe('in 2 minutes')
    expect(formatRelative(now.getTime() - 24 * HOUR, { now })).toBe('yesterday')
    expect(formatRelative(now.getTime() + 3 * 24 * HOUR, { now })).toBe('in 3 days')
    expect(formatRelative(now.getTime() - 14 * 24 * HOUR, { now })).toBe('2 weeks ago')
    expect(formatRelative(now.getTime() - 400 * 24 * HOUR, { now })).toBe('last year')
    expect(formatRelative(now.getTime() - 3 * HOUR, { now, numeric: 'always' })).toBe('3 hours ago')
  })

  it('counts a calendar day from today in the zone, at any hour', () => {
    expect(formatRelative('2026-11-02', { now })).toBe('yesterday')
    expect(formatRelative('2026-11-03', { now })).toBe('today')
    expect(formatRelative('2026-11-04', { now })).toBe('tomorrow')
    expect(formatRelative('2026-11-02', { now, timeZone: 'UTC' })).toBe('2 days ago')
  })
})
