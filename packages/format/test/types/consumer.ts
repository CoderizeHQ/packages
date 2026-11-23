// Type-checked by `tsc -p test/types` in `pnpm test`, as a TypeScript app would import the package
// (allsteeloffroad-com-web, the coderize-dev-mono portal). Nothing here runs.
import { csvCell, toCsv } from '@coderize/format/csv'
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
  zonedWallTimeToUtc
} from '@coderize/format/date'
import { centsToInput, formatCents, parseDollarsToCents } from '@coderize/format/money'
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
  type PhoneStatus
} from '@coderize/format/phone'
import { slugify } from '@coderize/format/slug'

const zone: 'America/Detroit' = DEFAULT_TIME_ZONE
const today: string = todayIn()
const day: string = calendarDay(new Date(), 'Asia/Kolkata')
const tomorrow: string = addDays(today, 1)
const due: string = utcDay(new Date('2026-11-03T00:00:00Z'))
const { start, end }: { start: Date; end: Date } = dayRangeUtc(today)
const startsAt: Date = zonedWallTimeToUtc({ year: 2026, month: 11, day: 3, hour: 21 })
const typed: Date | null = zonedWallTimeToUtc('2026-11-03T21:00')
const input: string = utcToZonedWallTime(startsAt, zone, { seconds: true })
const hour: number = zonedParts(startsAt).hour
const shown: string[] = [
  formatDate('2026-11-03', { style: 'long' }),
  formatDateTime(startsAt, { timeStyle: 'long' }),
  formatTime(start.toISOString()),
  formatRelative(end, { now: Date.now(), numeric: 'always' })
]
// @ts-expect-error a style Intl does not have
formatDate(today, { style: 'tiny' })

const cents: number | null = parseDollarsToCents('$1,234.56', { allowNegative: true })
const money: string = formatCents(cents ?? 0, { fraction: 'auto' })
const prefill: string = centsToInput(null)
// @ts-expect-error a fraction mode that does not exist
formatCents(100, { fraction: 'some' })

interface Signup {
  name: string
  phone: string | null
  amountCents: number
}
const rows: Signup[] = [{ name: 'Jane', phone: null, amountCents: 500 }]
const csv: string = toCsv<Signup>(
  ['name', { key: 'phone', label: 'Phone' }, { label: 'Amount', value: (row) => formatCents(row.amountCents) }],
  rows,
  { bom: false }
)
// @ts-expect-error a key the row does not have
toCsv<Signup>([{ key: 'email', label: 'Email' }], rows)
const cell: string = csvCell(new Date())

const phone = normalizePhone('810-555-0100 x23')
const parts: [string, string, boolean] = [phone.digits, phone.extension, phone.ok]
const status: PhoneStatus = phoneStatus(phone.digits)
const clear: boolean = status === PHONE_STATUS.CLEAR && !phoneNeedsFixing('8105550100') && samePhone('a', 'b')
const href: string | null = phoneHref('8105550100')
const stored: string | null = phoneForSaving<string | null>(null)
const display: string[] = [formatPhone('8105550100'), displayPhone(undefined), formatPhoneAsTyped('810')]

const slug: string = slugify('Rock & Roll', { maxLength: 60 })

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
  slug
]
