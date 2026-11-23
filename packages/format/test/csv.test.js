import { describe, expect, it } from 'vitest'

import { csvCell, toCsv } from '@coderize/format/csv'

const BOM = String.fromCharCode(0xfeff)

describe('csvCell', () => {
  it('leaves a plain cell alone', () => {
    expect(csvCell('Jane Doe')).toBe('Jane Doe')
    expect(csvCell(42)).toBe('42')
    expect(csvCell(true)).toBe('true')
  })

  it('writes null and undefined as empty, and a Date as its ISO timestamp', () => {
    expect(csvCell(null)).toBe('')
    expect(csvCell(undefined)).toBe('')
    expect(csvCell(new Date('2026-11-03T21:00:00Z'))).toBe('2026-11-03T21:00:00.000Z')
  })

  it('quotes a cell holding a quote, comma, CR or LF, doubling inner quotes (RFC 4180)', () => {
    expect(csvCell('Doe, Jane')).toBe('"Doe, Jane"')
    expect(csvCell('say "hi"')).toBe('"say ""hi"""')
    expect(csvCell('line one\nline two')).toBe('"line one\nline two"')
    expect(csvCell('a\rb')).toBe('"a\rb"')
  })

  it.each(['=HYPERLINK("http://evil","x")', '+1+1', '-2+3', '@SUM(A1)', '\tx', '\rx'])(
    'guards %j against running as a formula',
    (value) => {
      expect(csvCell(value).replace(/^"/, '')).toMatch(/^'/)
    }
  )

  it('keeps plain numbers, negative amounts included, as numbers', () => {
    expect(csvCell('-5.00')).toBe('-5.00')
    expect(csvCell(-5)).toBe('-5')
    expect(csvCell('5')).toBe('5')
  })

  it('guards and quotes together when both apply', () => {
    expect(csvCell('=1,2')).toBe(`"'=1,2"`)
  })

  it('can turn the guard off', () => {
    expect(csvCell('=SUM(A1)', { guard: false })).toBe('=SUM(A1)')
  })
})

describe('toCsv', () => {
  const rows = [
    { name: 'José Núñez', email: 'jose@example.com', amount: '-5.00' },
    { name: '=HYPERLINK("x")', email: null, amount: '12.50' }
  ]

  it('writes a BOM, a header and CRLF-terminated lines', () => {
    const csv = toCsv(
      [
        { key: 'name', label: 'Name' },
        { key: 'email', label: 'Email' },
        { key: 'amount', label: 'Amount' }
      ],
      rows
    )
    expect(csv).toBe(`${BOM}Name,Email,Amount\r\nJosé Núñez,jose@example.com,-5.00\r\n"'=HYPERLINK(""x"")",,12.50\r\n`)
  })

  it('leaves the BOM off when asked', () => {
    expect(toCsv(['name'], [{ name: 'a' }], { bom: false })).toBe('name\r\na\r\n')
  })

  it('takes a string column as key and label, and a value function for computed cells', () => {
    const csv = toCsv(['name', { label: 'Row', value: (row, i) => i + 1 }], rows, { bom: false })
    expect(csv.split('\r\n')).toEqual(['name,Row', 'José Núñez,1', `"'=HYPERLINK(""x"")",2`, ''])
  })

  it('guards the header too, and can turn the guard off for every cell', () => {
    expect(toCsv([{ key: 'a', label: '=A' }], [{ a: '=1' }], { bom: false })).toBe(`'=A\r\n'=1\r\n`)
    expect(toCsv([{ key: 'a', label: '=A' }], [{ a: '=1' }], { bom: false, guard: false })).toBe('=A\r\n=1\r\n')
  })

  it('writes just the header for no rows, and takes any iterable', () => {
    expect(toCsv(['a', 'b'], [], { bom: false })).toBe('a,b\r\n')
    expect(toCsv(['a'], new Set([{ a: 1 }]), { bom: false })).toBe('a\r\n1\r\n')
  })

  it('refuses a column with no key or value', () => {
    expect(() => toCsv([{ label: 'x' }], [])).toThrow(TypeError)
  })
})
