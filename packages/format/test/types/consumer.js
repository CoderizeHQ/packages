// Type-checked by `tsc -p test/types` in `pnpm test` (checkJs), as an app would import the package: a TypeScript app,
// or JavaScript checked against the package's .d.ts files. Nothing here runs.
import { csvCell, toCsv } from '@coderizehq/format/csv'
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
import { centsToInput, formatCents, parseDollarsToCents } from '@coderizehq/format/money'
import {
  displayPhone,
  formatPhone,
  formatPhoneAsTyped,
  normalizePhone,
  PHONE_STATUS,
  phoneForSaving,
  phoneHref,
  phoneNeedsFixing,
  phoneStatus,
  samePhone,
} from '@coderizehq/format/phone'
import { slugify } from '@coderizehq/format/slug'

/** @import { PhoneStatus } from '@coderizehq/format/phone' */

/** @type {'America/Detroit'} */
const zone = DEFAULT_TIME_ZONE
/** @type {string} */
const today = todayIn()
/** @type {string} */
const day = calendarDay(new Date(), 'Asia/Kolkata')
/** @type {string} */
const tomorrow = addDays(today, 1)
/** @type {string} */
const due = utcDay(new Date('2026-11-03T00:00:00Z'))
/** @type {{ start: Date, end: Date }} */
const { start, end } = dayRangeUtc(today)
/** @type {Date} */
const startsAt = zonedWallTimeToUtc({ year: 2026, month: 11, day: 3, hour: 21 })
/** @type {Date | null} */
const typed = zonedWallTimeToUtc('2026-11-03T21:00')
/** @type {string} */
const input = utcToZonedWallTime(startsAt, zone, { seconds: true })
/** @type {number} */
const hour = zonedParts(startsAt).hour
/** @type {string[]} */
const shown = [
  formatDate('2026-11-03', { style: 'long' }),
  formatDateTime(startsAt, { timeStyle: 'long' }),
  formatTime(start.toISOString()),
  formatRelative(end, { now: Date.now(), numeric: 'always' }),
]
// @ts-expect-error a style Intl does not have
formatDate(today, { style: 'tiny' })

/** @type {number | null} */
const cents = parseDollarsToCents('$1,234.56', { allowNegative: true })
/** @type {string} */
const money = formatCents(cents ?? 0, { fraction: 'auto' })
/** @type {string} */
const prefill = centsToInput(null)
// @ts-expect-error a fraction mode that does not exist
formatCents(100, { fraction: 'some' })

/** @typedef {{ name: string, phone: string | null, amountCents: number }} Signup */
/** @type {Signup[]} */
const rows = [{ name: 'Jane', phone: null, amountCents: 500 }]
/** @type {string} */
const csv = toCsv(
  ['name', { key: 'phone', label: 'Phone' }, { label: 'Amount', value: (row) => formatCents(row.amountCents) }],
  rows,
  { bom: false },
)
// @ts-expect-error a key the row does not have
toCsv([{ key: 'email', label: 'Email' }], rows)
/** @type {string} */
const cell = csvCell(new Date())

const phone = normalizePhone('810-555-0100 x23')
/** @type {[string, string, boolean]} */
const parts = [phone.digits, phone.extension, phone.ok]
/** @type {PhoneStatus} */
const status = phoneStatus(phone.digits)
/** @type {boolean} */
const clear = status === PHONE_STATUS.CLEAR && !phoneNeedsFixing('8105550100') && samePhone('a', 'b')
/** @type {string | null} */
const href = phoneHref('8105550100')
/** @type {string | null} */
const stored = phoneForSaving(/** @type {string | null} */ (null))
/** @type {string[]} */
const display = [formatPhone('8105550100'), displayPhone(undefined), formatPhoneAsTyped('810')]

/** @type {string} */
const slug = slugify('Rock & Roll', { maxLength: 60 })

export const used = [
  zone,
  day,
  tomorrow,
  due,
  typed,
  input,
  hour,
  shown,
  money,
  prefill,
  csv,
  cell,
  parts,
  clear,
  href,
  stored,
  display,
  slug,
]
