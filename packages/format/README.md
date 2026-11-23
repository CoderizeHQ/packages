# @coderize/format

The formatting rules every CoderizeDEV app keeps rewriting: Michigan-time days and wall-clock times, integer-cents
money, CSV downloads, US phone numbers and URL slugs. One copy, tested, so the API, the admin screens and the
public site agree.

```bash
pnpm add @coderize/format
```

**No dependencies, no imports.** Every module is plain ESM built on `Intl`, so the same file runs in the browser
(Vite SPAs, Astro islands), in Node 24 (Fastify APIs, scripts) and in an Astro build. Plain JavaScript with
TypeScript types included.

Each area is its own subpath, so a page that formats money doesn't load the CSV writer. There is no root import.

| Subpath                  | What it does                                                                     |
| ------------------------ | -------------------------------------------------------------------------------- |
| `@coderize/format/date`  | today, day ranges and wall-clock times in America/Detroit (or any zone); display |
| `@coderize/format/money` | integer cents to `$1,234.56`, typed dollars to cents                             |
| `@coderize/format/csv`   | rows to CSV with RFC 4180 quoting, the formula-injection guard and a UTF-8 BOM   |
| `@coderize/format/phone` | 10-digit US numbers with extensions: normalise, store, display, `tel:` links     |
| `@coderize/format/slug`  | title to URL slug, for new slugs only                                            |

The card-fee gross-up ("cover the processing fee") is not here: it lives in `@coderize/stripe/fees`, next to the
Stripe code it has to agree with.

## `@coderize/format/date`

Every function takes the time zone as a parameter, defaulting to `America/Detroit` (`DEFAULT_TIME_ZONE`). Nothing
reads the zone of the device or server it runs on: the tests run the whole suite under UTC, America/Detroit and
Asia/Kolkata to hold that.

```js
import { dayRangeUtc, formatDateTime, todayIn, zonedWallTimeToUtc } from '@coderize/format/date'

todayIn() // '2026-11-03' at 9 pm in Detroit, when the UTC day is already the 4th
const { start, end } = dayRangeUtc(todayIn()) // tonight's events: start <= startsAt < end
const startsAt = zonedWallTimeToUtc(form.startsAt) // '2026-11-03T18:00' typed in any browser = 6 pm Detroit
formatDateTime(event.startsAt) // 'Nov 3, 2026, 6:00 PM'
```

### Days

A calendar day is a `YYYY-MM-DD` string. An instant is a `Date`, a millisecond timestamp, or an ISO string that
names its offset (`2026-11-04T02:00:00.000Z`, what JSON gives you for a `Date`). A timestamp with no offset
(`2026-11-03T18:00`) is refused with a `RangeError`: it names a different instant in every zone. Read it with
`zonedWallTimeToUtc`.

| Function                          | Returns                                                                                |
| --------------------------------- | -------------------------------------------------------------------------------------- |
| `todayIn(timeZone?, now?)`        | today in the zone, `YYYY-MM-DD`                                                        |
| `calendarDay(instant, timeZone?)` | the day an instant falls on in the zone; a `YYYY-MM-DD` comes back as is               |
| `utcDay(value)`                   | the day a date-only column holds (see below)                                           |
| `addDays(day, n)`                 | a day moved by whole calendar days                                                     |
| `dayRangeUtc(day, timeZone?)`     | `{ start, end }`: the day's first instant and the next day's first instant (exclusive) |
| `zonedParts(instant, timeZone?)`  | `{ year, month, day, hour, minute, second, weekday }` as the zone's clock reads        |

**Never "today" from `new Date().toISOString().slice(0, 10)`.** That is the UTC day, which turns over at 8 pm EDT
(7 pm EST), so every evening a default date becomes tomorrow and "is this past?" calls today's item past.

**A day is not always 24 hours.** `dayRangeUtc('2026-03-08')` is 23 hours and `dayRangeUtc('2026-11-01')` is 25.
`start + 24h` ends the window an hour early or late on those days. Use `end`.

**Date-only columns.** Prisma returns a `@db.Date` as midnight UTC on that day, which is the evening before in
Michigan. `calendarDay(due)` would say the 2nd for a due date of the 3rd; `utcDay(due)` says the 3rd. Compare it
with `todayIn()`.

### Wall-clock times (admin forms)

A `datetime-local` input gives `YYYY-MM-DDTHH:MM` with no zone. `new Date(value)` reads it in the browser's zone,
which is how a month of Xceptional Heroes events landed 8 hours off in August 2026. Pin both directions:

```js
;<input type="datetime-local" defaultValue={utcToZonedWallTime(event.startsAt)} />
// on submit
body.startsAt = zonedWallTimeToUtc(form.startsAt)?.toISOString() ?? null
```

| Function                                              | Returns                                                       |
| ----------------------------------------------------- | ------------------------------------------------------------- |
| `zonedWallTimeToUtc(wall, timeZone?)`                 | the `Date` when the zone's clock reads `wall`; null for empty |
| `utcToZonedWallTime(instant, timeZone?, { seconds })` | `YYYY-MM-DDTHH:MM` as the zone's clock reads; '' for empty    |

`wall` is `YYYY-MM-DDTHH:MM`, `YYYY-MM-DDTHH:MM:SS`, `YYYY-MM-DD` (midnight) or `{ year, month, day, hour?,
minute?, second? }`. On the nights the clocks change:

- **A time that happens twice** (01:30 on 2026-11-01) is the first of the two, EDT.
- **A time that never happens** (02:30 on 2026-03-08) moves forward by the gap, to 03:30 EDT.

These are `Temporal`'s "compatible" rules.

### Display

| Function                                                                                 | Example                    |
| ---------------------------------------------------------------------------------------- | -------------------------- |
| `formatDate(value, { timeZone, style = 'medium', locale })`                              | `Nov 3, 2026`              |
| `formatDateTime(value, { timeZone, dateStyle = 'medium', timeStyle = 'short', locale })` | `Nov 3, 2026, 9:00 PM`     |
| `formatTime(value, { timeZone, style = 'short', locale })`                               | `9:00 PM`                  |
| `formatRelative(value, { now, timeZone, locale, numeric = 'auto' })`                     | `3 hours ago`, `yesterday` |

- Styles are `Intl`'s `full`, `long`, `medium` and `short`. A `timeStyle` of `long` adds the zone (`9:00:00 PM EST`).
- `formatDate('2026-11-03')` prints that day in any zone. An instant prints as its day in `timeZone`.
- `formatDateTime` and `formatTime` need an instant; a bare day throws.
- `formatRelative` measures an instant in elapsed time from `now`, and counts a `YYYY-MM-DD` day in calendar days
  from today in `timeZone`, so yesterday's date reads "yesterday" at any hour.
- Empty values (`null`, `undefined`, `''`) format as `''`.
- Output always uses plain spaces. Some ICU versions put a narrow no-break space before AM/PM, which made an Astro
  build and the browser hydrating it disagree.

## `@coderize/format/money`

Money is integer cents in the database, the API and the browser. Only a screen turns cents into dollars, and only
an input box turns dollars back into cents. Nothing here does float arithmetic.

```js
import { centsToInput, formatCents, parseDollarsToCents } from '@coderize/format/money'

formatCents(123456) // '$1,234.56'
formatCents(-1234) // '-$12.34'
formatCents(25000, { fraction: 'auto' }) // '$250'      (whole dollars drop .00)
formatCents(123450, { fraction: 'never' }) // '$1,235'  (headline figures, half away from zero)
centsToInput(123456) // '1234.56', to prefill an amount field
parseDollarsToCents('$1,234.56') // 123456
parseDollarsToCents('1.234') // null: three places, maybe a European thousands separator
```

- `formatCents(cents, { fraction })`: en-US, thousands separators, the minus before the `$`. `fraction` is
  `always` (default), `auto` or `never`. `null`/`undefined` give `''`. **A non-integer throws a `TypeError`**: it
  means dollars were passed where cents belong, a 100x error that would otherwise ship quietly.
- `centsToInput(cents)`: `1234.56`, no `$` or commas, so `parseDollarsToCents` reads it back.
- `parseDollarsToCents(input, { allowNegative = false })`: reads `12`, `12.5`, `.50`, `$1,234.56`. Returns `null`
  for anything it can't read exactly, rather than guess: three or more decimal places, commas that aren't
  thousands groups (`1,23`), a trailing point, words, exponents, `+`, two signs, a negative unless allowed, or an
  amount too large to be exact. It takes only a string: pass the input's text, never a parsed number.

## `@coderize/format/csv`

```js
import { toCsv } from '@coderize/format/csv'

const csv = toCsv(
  [
    { key: 'name', label: 'Name' },
    'email', // key and label
    { label: 'Amount', value: (row) => (row.amountCents / 100).toFixed(2) }
  ],
  rows
)
reply
  .header('content-type', 'text/csv; charset=utf-8')
  .header('content-disposition', 'attachment; filename="donations.csv"')
  .send(csv)
```

- **Formula-injection guard, on by default.** A cell starting with `=`, `+`, `-`, `@`, a tab or a carriage return
  gets a leading apostrophe, because Excel and Sheets would otherwise run it: names in these files come from public
  forms, and `=HYPERLINK(...)` is a working attack. A plain number such as `-5.00` is left alone so amounts stay
  numbers. `{ guard: false }` turns it off, for a file no spreadsheet will open.
- **UTF-8 BOM, on by default.** Without it Excel reads the file in the local code page and garbles accented names
  (`José`). `{ bom: false }` leaves it off, for a consumer that would read the BOM as part of the first header.
- **RFC 4180 quoting:** a cell holding `"`, `,`, CR or LF is quoted with inner quotes doubled; lines end in CRLF,
  including the last.
- `null` and `undefined` are empty cells; a `Date` is its ISO timestamp. Format dates and money yourself (with
  the other subpaths) when the reader wants them as text.
- `rows` is any iterable. `csvCell(value, { guard })` is the single-cell writer, for a streaming export.

## `@coderize/format/phone`

Promoted from Xceptional Heroes' `@xh/phone`. A standard number is 10 digits, or 11 starting with 1 (the 1 is
dropped), with any punctuation, optionally followed by an extension (`x23`, `ext. 23`, `extension 23`, `#23`).
Anything else that isn't blank (too few or too many digits, letters, two numbers in one field) is **never guessed
at**: it is stored as typed, shown as typed and reported as `TO_FIX`.

| Function                  | Example                                                                          |
| ------------------------- | -------------------------------------------------------------------------------- |
| `normalizePhone(value)`   | `{ digits: '8105550100', extension: '23', ok: true }`; both empty when not `ok`  |
| `phoneForSaving(value)`   | `'8105550100'`, `'8105550100x23'`, or the typed text trimmed; non-strings as is  |
| `displayPhone(value)`     | `'(810) 555-0100 ext. 23'`, or the value as stored                               |
| `formatPhone(stored)`     | a stored `8105550100[x23]` formatted; anything else unchanged                    |
| `phoneHref(value)`        | `'tel:+18105550100'`, `'tel:+18105550100;ext=23'` (RFC 3966), or null            |
| `samePhone(a, b)`         | same digits and extension, or the same text when neither is standard             |
| `phoneStatus(value)`      | `BLANK`, `CLEAR` or `TO_FIX` (`PHONE_STATUS`); `phoneNeedsFixing(value)`         |
| `formatPhoneAsTyped(raw)` | `(810) 555-0100` while typing; drops a leading 1 (no US area code starts with 1) |

`formatPhoneAsTyped` keeps ten digits, so an extension needs its own field when a form masks input.

## `@coderize/format/slug`

```js
import { slugify } from '@coderize/format/slug'

slugify('Café Rock & Roll Night') // 'cafe-rock-and-roll-night'
slugify("Joe's Pizza") // 'joes-pizza'
slugify(title, { maxLength: 60 }) // cut at the last whole word that fits
```

Accents are folded, `&` reads as "and", apostrophes are dropped, and anything else that isn't `a-z0-9` becomes one
hyphen.

**For new slugs only.** Never run it over records that already have URLs: a changed slug breaks every link and
bookmark to the page and loses its search ranking. Generate a slug once, store it, and keep it.

## Moving an app onto it

Each app adopts in its own PR. The package deliberately differs from some of the copies it replaces, so check
these when swapping:

- **Evening "today".** Copies that take today from `toISOString()` or the browser's zone change after 8 pm EDT /
  7 pm EST, and so do any defaults they store.
- **Day windows.** gronetworking's `localDayRangeUtc` adds 24 hours; `dayRangeUtc` gives 23 and 25 on clock-change
  days.
- **The spring-forward gap.** The XH portal's `fromLocalInput` moves 02:30 on 2026-03-08 back to 01:30 EST;
  `zonedWallTimeToUtc` moves it forward to 03:30 EDT, as the XH API's series code already did. Every other time
  agrees.
- **Money formatters that take dollars** (`usd(n)`, `money(val)`) must be given cents; a float throws.
- **Money display** gains thousands separators where they were missing and puts the minus before the `$`.
  Whole-dollar displays that hid `.00` need `{ fraction: 'auto' }`.
- **Dollar parsers** that stripped every comma read `1,23` as 123; this one refuses it. Negatives need
  `allowNegative`. Parsers that returned `NaN` or `Infinity` now return `null`, and an upper limit is the caller's
  check.
- **CSV writers** gain the guard: a text cell starting with `-` or `+` (not a plain number) now gets an apostrophe.
  Writers without a BOM gain one.
- **Phone numbers with extensions** were `TO_FIX` in `@xh/phone`; they are now standard and stored as
  `8105550100x23`. gronetworking stored 11 digits with the leading 1, and imlay cut extensions off: both need a
  one-time tidy of stored values.
- **Slugs** from the older copies differ for accents, `&` and apostrophes (`caf`, `rock-roll`, `joe-s`). Existing
  slugs stay as they are.

## Versioning

A patch changes nothing a caller can see; a minor adds something it can opt into; a major changes an output or
refuses an input that was accepted before (any of the rules above), because every app's stored data and screens
depend on them.
