import { describe, expect, it } from 'vitest'

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
  samePhone
} from '@coderize/format/phone'

describe('normalizePhone', () => {
  it.each(['8105550100', '(810) 555-0100', '810.555.0100', '+1 810 555 0100', '1-810-555-0100', ' 810 555 0100 '])(
    'reads %j as 8105550100',
    (typed) => {
      expect(normalizePhone(typed)).toEqual({ digits: '8105550100', extension: '', ok: true })
    }
  )

  it.each([
    ['810-555-0100 x23', '23'],
    ['810-555-0100x23', '23'],
    ['(810) 555-0100 ext. 23', '23'],
    ['(810) 555-0100 ext 23', '23'],
    ['810 555 0100 Extension 4567', '4567'],
    ['810-555-0100, #9', '9'],
    ['8105550100x23', '23']
  ])('keeps the extension of %j', (typed, extension) => {
    expect(normalizePhone(typed)).toEqual({ digits: '8105550100', extension, ok: true })
  })

  it.each([
    ['555-0100', 'too few digits'],
    ['810555010012', 'too many digits'],
    ['28105550100', '11 digits not starting with 1'],
    ['1-800-FLOWERS', 'letters'],
    ['call the office', 'words'],
    ['810-555-0100 or 810-555-0101', 'two numbers'],
    ['810-555-0100 x', 'an extension marker with no number'],
    ['', 'blank'],
    [null, 'null']
  ])('never guesses at %j (%s)', (typed) => {
    expect(normalizePhone(typed)).toEqual({ digits: '', extension: '', ok: false })
  })
})

describe('display and links', () => {
  it('formats a stored number with or without an extension', () => {
    expect(formatPhone('8105550100')).toBe('(810) 555-0100')
    expect(formatPhone('8105550100x23')).toBe('(810) 555-0100 ext. 23')
    expect(formatPhone('555-0100')).toBe('555-0100')
    expect(formatPhone(null)).toBe('')
  })

  it('shows a standard number formatted and anything else as typed', () => {
    expect(displayPhone('+1 (810) 555 0100')).toBe('(810) 555-0100')
    expect(displayPhone('810.555.0100 ext 7')).toBe('(810) 555-0100 ext. 7')
    expect(displayPhone('call the office')).toBe('call the office')
    expect(displayPhone(null)).toBe('')
  })

  it('builds a tel: link only for a number it is sure of', () => {
    expect(phoneHref('(810) 555-0100')).toBe('tel:+18105550100')
    expect(phoneHref('810-555-0100 x23')).toBe('tel:+18105550100;ext=23')
    expect(phoneHref('555-0100')).toBeNull()
  })
})

describe('saving and comparing', () => {
  it('stores the digits of a standard number and the typed text otherwise', () => {
    expect(phoneForSaving(' (810) 555-0100 ')).toBe('8105550100')
    expect(phoneForSaving('810-555-0100 ext. 23')).toBe('8105550100x23')
    expect(phoneForSaving('  call the office ')).toBe('call the office')
    expect(phoneForSaving(null)).toBeNull()
    expect(phoneForSaving(undefined)).toBeUndefined()
  })

  it('stores what it reads back the same', () => {
    for (const typed of ['(810) 555-0100', '810-555-0100 x23']) {
      const stored = phoneForSaving(typed)
      expect(phoneForSaving(stored)).toBe(stored)
      expect(displayPhone(stored)).toBe(displayPhone(typed))
    }
  })

  it('compares numbers by digits and extension, and anything else by text', () => {
    expect(samePhone('810-555-0100', '(810) 555 0100')).toBe(true)
    expect(samePhone('810-555-0100 x2', '8105550100x2')).toBe(true)
    expect(samePhone('810-555-0100 x2', '810-555-0100 x3')).toBe(false)
    expect(samePhone('810-555-0100', '810-555-0100 x3')).toBe(false)
    expect(samePhone(' office ', 'office')).toBe(true)
    expect(samePhone('', null)).toBe(true)
  })

  it('sorts a value into blank, clear or to fix', () => {
    expect(phoneStatus('  ')).toBe(PHONE_STATUS.BLANK)
    expect(phoneStatus(null)).toBe(PHONE_STATUS.BLANK)
    expect(phoneStatus('8105550100x9')).toBe(PHONE_STATUS.CLEAR)
    expect(phoneStatus('555-0100')).toBe(PHONE_STATUS.TO_FIX)
    expect(phoneNeedsFixing('555-0100')).toBe(true)
    expect(phoneNeedsFixing('')).toBe(false)
  })
})

describe('formatPhoneAsTyped', () => {
  it.each([
    ['', ''],
    ['8', '(8'],
    ['810', '(810'],
    ['8105', '(810) 5'],
    ['810555', '(810) 555'],
    ['8105550', '(810) 555-0'],
    ['8105550100', '(810) 555-0100'],
    ['81055501009', '(810) 555-0100'],
    ['1810555', '(810) 555'],
    ['+1 (810) 555-0100', '(810) 555-0100']
  ])('shows %j as %j', (raw, shown) => {
    expect(formatPhoneAsTyped(raw)).toBe(shown)
  })
})
