# Changelog

Moved here from CoderizeDEV/coderize-platform (`packages/format` at c60309c) and renamed `@coderizehq/format`. The entries from 0.1.1 down are `@coderize/format`'s, released from that repo with Changesets; its git history stays there.

## 0.1.1

### Patch Changes

- First release through the coderize-platform release workflow (npm trusted publishing). No code changes from 0.1.0.

## 0.1.0

### Minor Changes

- First release: `@coderize/format/date` (`todayIn`, `calendarDay`, `utcDay`, `addDays`, `dayRangeUtc` with 23- and 25-hour days, `zonedWallTimeToUtc` and `utcToZonedWallTime` for admin forms, `zonedParts`, and the `formatDate`, `formatDateTime`, `formatTime` and `formatRelative` formatters, all in America/Detroit unless told otherwise), `@coderize/format/money` (`formatCents`, `centsToInput`, `parseDollarsToCents`), `@coderize/format/csv` (`toCsv` and `csvCell` with RFC 4180 quoting, the formula-injection guard and a UTF-8 BOM), `@coderize/format/phone` (Xceptional Heroes' phone rule, now keeping extensions, plus `formatPhoneAsTyped`) and `@coderize/format/slug` (`slugify`), with TypeScript types and no dependencies.
