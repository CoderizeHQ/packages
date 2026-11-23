import { describe, expect, it } from 'vitest'

import { slugify } from '@coderizehq/format/slug'

describe('slugify', () => {
  it.each([
    ['Café', 'cafe'],
    ['São Paulo Crème Brûlée', 'sao-paulo-creme-brulee'],
    ['Rock & Roll', 'rock-and-roll'],
    ['Joe’s Pizza', 'joes-pizza'],
    ["Joe's Pizza", 'joes-pizza'],
    ['Straße', 'strasse'],
    ['Smørrebrød', 'smorrebrod'],
    ['  --Hello,  World!--  ', 'hello-world'],
    ['2026 Blueberry Festival', '2026-blueberry-festival'],
    ['UPPER lower', 'upper-lower'],
    ['!!!', ''],
    ['', ''],
    [null, ''],
  ])('slugs %j as %j', (text, slug) => {
    expect(slugify(text)).toBe(slug)
  })

  it('cuts at the last whole word that fits', () => {
    expect(slugify('Annual Lapeer County Pancake Breakfast', { maxLength: 20 })).toBe('annual-lapeer-county')
    expect(slugify('Annual Lapeer County Pancake Breakfast', { maxLength: 22 })).toBe('annual-lapeer-county')
    expect(slugify('Annual Lapeer County', { maxLength: 20 })).toBe('annual-lapeer-county')
    expect(slugify('Supercalifragilistic', { maxLength: 5 })).toBe('super')
  })

  it('refuses a maxLength that is not a positive whole number', () => {
    expect(() => slugify('x', { maxLength: 0 })).toThrow(RangeError)
  })
})
