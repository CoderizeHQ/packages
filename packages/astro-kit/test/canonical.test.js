import { describe, expect, it } from 'vitest'

import { canonicalUrl, stripTrailingSlash } from '../canonical.js'

describe('stripTrailingSlash', () => {
  it('drops the trailing slash and keeps the root', () => {
    expect(stripTrailingSlash('/events/')).toBe('/events')
    expect(stripTrailingSlash('/events')).toBe('/events')
    expect(stripTrailingSlash('/a/b//')).toBe('/a/b')
    expect(stripTrailingSlash('/')).toBe('/')
    expect(stripTrailingSlash('')).toBe('/')
  })
})

describe('canonicalUrl', () => {
  it('resolves a path against the site in the no-slash form', () => {
    expect(canonicalUrl('/events/', 'https://example.com')).toBe('https://example.com/events')
    expect(canonicalUrl('/', 'https://example.com')).toBe('https://example.com/')
    expect(canonicalUrl('/support-us', new URL('https://example.com/'))).toBe('https://example.com/support-us')
  })

  it('normalises an absolute URL without needing the site', () => {
    expect(canonicalUrl('https://example.com/about/')).toBe('https://example.com/about')
    expect(canonicalUrl('https://example.com')).toBe('https://example.com/')
  })

  it('drops the query string and fragment', () => {
    expect(canonicalUrl('/events/?utm_source=x#top', 'https://example.com')).toBe('https://example.com/events')
  })

  it('keeps file extensions', () => {
    expect(canonicalUrl('/sitemap-index.xml', 'https://example.com')).toBe('https://example.com/sitemap-index.xml')
  })

  it('refuses a path with no site, and an empty value', () => {
    expect(() => canonicalUrl('/events')).toThrow(/pass the site URL/)
    expect(() => canonicalUrl('', 'https://example.com')).toThrow(/needs a path/)
  })
})
