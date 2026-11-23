// CSV for downloads opened in Excel, Google Sheets and contact importers. Lifted from
// xceptionalheroes-org-mono's lib/csv.js, the one fleet copy that had both of these:
//
// - Formula injection guard, on by default. A cell starting with = + - @, a tab or a carriage
//   return gets a leading apostrophe, because a spreadsheet would otherwise run it as a formula,
//   and names in these files come from public forms (`=HYPERLINK(...)`). A plain number such as
//   `-5.00` is left alone so amounts stay numbers.
// - A UTF-8 byte-order mark, on by default. Without it Excel reads the file in the local code page
//   and turns accented names ("José") into garbage.
//
// Quoting follows RFC 4180: a cell holding a quote, comma, CR or LF is wrapped in quotes with
// inner quotes doubled, and lines end in CRLF.

const FORMULA_START = /^[=+\-@\t\r]/
const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/
const NEEDS_QUOTES = /[",\r\n]/
// The UTF-8 byte-order mark, U+FEFF, built from its code point so no editor strips it unseen.
const BOM = String.fromCharCode(0xfeff)

function text(value) {
  if (value == null) return ''
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : value.toISOString()
  return String(value)
}

/**
 * One CSV cell: guarded and quoted as needed. null and undefined are empty; a Date is its ISO
 * timestamp.
 * @param {unknown} value
 * @param {{ guard?: boolean }} [options]
 * @returns {string}
 */
export function csvCell(value, { guard = true } = {}) {
  let s = text(value)
  if (guard && FORMULA_START.test(s) && !PLAIN_NUMBER.test(s)) s = `'${s}`
  return NEEDS_QUOTES.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function readColumn(column, i) {
  if (typeof column === 'string') return { label: column, read: (row) => row?.[column] }
  if (column && typeof column.value === 'function') {
    return { label: column.label ?? '', read: (row, index) => column.value(row, index) }
  }
  if (column && column.key != null) return { label: column.label ?? column.key, read: (row) => row?.[column.key] }
  throw new TypeError(`Column ${i} needs a key, a value function, or to be a string`)
}

/**
 * Rows of objects as a CSV document: a header line of labels, then one line per row.
 * @template T
 * @param {Array<string | { key: string, label?: string } | { label: string, value: (row: T, index: number) => unknown }>} columns
 *   a string is both key and label
 * @param {Iterable<T>} rows
 * @param {{ bom?: boolean, guard?: boolean }} [options] both default to true
 * @returns {string}
 */
export function toCsv(columns, rows, { bom = true, guard = true } = {}) {
  const cols = columns.map(readColumn)
  const lines = [cols.map((c) => csvCell(c.label, { guard })).join(',')]
  let index = 0
  for (const row of rows) {
    lines.push(cols.map((c) => csvCell(c.read(row, index), { guard })).join(','))
    index++
  }
  return `${bom ? BOM : ''}${lines.join('\r\n')}\r\n`
}
