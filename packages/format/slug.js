// Title to URL slug, seeded from xceptionalheroes-org-mono's event pages: accents folded
// (Café → cafe), & read as "and" (Rock & Roll → rock-and-roll), apostrophes dropped
// (Joe's → joes), anything else that isn't a-z or 0-9 becomes one hyphen.
//
// For NEW slugs only. Never re-slug a record that already has a URL: a changed slug breaks every
// link and bookmark to it and loses its search ranking. Store the slug; don't recompute it.

// Letters NFKD does not split into a base letter and an accent.
const FOLD = { ß: 'ss', æ: 'ae', œ: 'oe', ø: 'o', ł: 'l', đ: 'd', ð: 'd', þ: 'th', ı: 'i' }

/**
 * @param {unknown} text
 * @param {{ maxLength?: number }} [options] maxLength cuts at the last whole word that fits
 * @returns {string} '' when nothing sluggable is left
 */
export function slugify(text, { maxLength } = {}) {
  let slug = String(text ?? '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[ßæœøłđðþı]/g, (c) => FOLD[c])
    .replace(/['’‘`]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (maxLength != null) {
    if (!Number.isInteger(maxLength) || maxLength < 1) throw new RangeError(`maxLength must be a positive whole number`)
    if (slug.length > maxLength) {
      const cut = slug.slice(0, maxLength)
      // Cut on a word boundary unless the slug is one long word.
      slug = slug[maxLength] === '-' ? cut : cut.includes('-') ? cut.replace(/-[^-]*$/, '') : cut
      slug = slug.replace(/-+$/, '')
    }
  }
  return slug
}
