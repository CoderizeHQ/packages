/** CSV with RFC 4180 quoting, a formula-injection guard and a UTF-8 BOM. */

export type CsvColumn<T> =
  string | { key: keyof T & string; label?: string } | { label: string; value: (row: T, index: number) => unknown }

export interface CsvOptions {
  /** Start the document with a UTF-8 byte-order mark (default true). */
  bom?: boolean
  /** Prefix cells starting with = + - @ tab or CR with an apostrophe (default true). */
  guard?: boolean
}

/** One CSV cell, guarded and quoted as needed. */
export declare function csvCell(value: unknown, options?: { guard?: boolean }): string

/** Rows as a CSV document: a header line of labels, then one CRLF-terminated line per row. */
export declare function toCsv<T>(columns: CsvColumn<T>[], rows: Iterable<T>, options?: CsvOptions): string
