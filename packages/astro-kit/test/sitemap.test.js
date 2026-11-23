import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { hasNoindex, sitemapOptions } from '../sitemap.js'

let dist

function page(path, head = '') {
  const file = path === '/' ? 'index.html' : `${path.replace(/^\//, '')}/index.html`
  mkdirSync(join(dist, file, '..'), { recursive: true })
  writeFileSync(join(dist, file), `<!doctype html><html><head>${head}</head><body></body></html>`)
}

beforeAll(() => {
  dist = mkdtempSync(join(tmpdir(), 'astro-kit-dist-'))
  page('/')
  page('/about')
  page('/events/past', '<meta name="robots" content="noindex">')
  page('/thanks', "<meta content='nofollow, noindex' name='robots'>")
  writeFileSync(join(dist, '404.html'), '<meta name="robots" content="noindex">')
})

afterAll(() => rmSync(dist, { recursive: true, force: true }))

describe('sitemapOptions().serialize', () => {
  it('strips the trailing slash (Recipe A) and keeps the root', () => {
    const { serialize } = sitemapOptions({ lastmod: 'none', distDir: dist })
    expect(serialize({ url: 'https://example.com/about/' })).toEqual({ url: 'https://example.com/about' })
    expect(serialize({ url: 'https://example.com/' })).toEqual({ url: 'https://example.com/' })
  })

  it('leaves Recipe B URLs, which arrive without a slash, unchanged', () => {
    const { serialize } = sitemapOptions({ lastmod: 'none', distDir: dist })
    expect(serialize({ url: 'https://example.com/about' })).toEqual({ url: 'https://example.com/about' })
  })

  it('stamps one build time on every URL by default', () => {
    const { serialize } = sitemapOptions({ distDir: dist })
    const a = serialize({ url: 'https://example.com/a/' })
    const b = serialize({ url: 'https://example.com/b/' })
    expect(a.lastmod).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(b.lastmod).toBe(a.lastmod)
  })

  it('takes lastmod from a function, and drops it for none', () => {
    const { serialize } = sitemapOptions({
      distDir: dist,
      lastmod: (url) => (url.endsWith('/news') ? new Date('2026-10-01T00:00:00Z') : undefined),
    })
    expect(serialize({ url: 'https://example.com/news/' })).toEqual({
      url: 'https://example.com/news',
      lastmod: '2026-10-01T00:00:00.000Z',
    })
    expect(serialize({ url: 'https://example.com/other/', lastmod: 'x' })).toEqual({ url: 'https://example.com/other' })
  })

  it('keeps the other fields the integration sets', () => {
    const { serialize } = sitemapOptions({ lastmod: 'none', distDir: dist })
    expect(serialize({ url: 'https://example.com/a/', changefreq: 'weekly', links: [] })).toEqual({
      url: 'https://example.com/a',
      changefreq: 'weekly',
      links: [],
    })
  })

  it('refuses an unknown lastmod', () => {
    expect(() => sitemapOptions({ lastmod: 'daily' })).toThrow(/lastmod/)
  })
})

describe('sitemapOptions().filter', () => {
  it('leaves out pages whose built HTML is noindex', () => {
    const { filter } = sitemapOptions({ distDir: dist })
    expect(filter('https://example.com/')).toBe(true)
    expect(filter('https://example.com/about/')).toBe(true)
    expect(filter('https://example.com/events/past/')).toBe(false)
    expect(filter('https://example.com/thanks')).toBe(false)
  })

  it('accepts the dist folder as a file URL', () => {
    const { filter } = sitemapOptions({ distDir: pathToFileURL(`${dist}/`) })
    expect(filter('https://example.com/events/past/')).toBe(false)
  })

  it('keeps a page it cannot find in the build', () => {
    const { filter } = sitemapOptions({ distDir: dist })
    expect(filter('https://example.com/not-built/')).toBe(true)
  })

  it('can skip the noindex check', () => {
    const { filter } = sitemapOptions({ distDir: dist, skipNoindex: false })
    expect(filter('https://example.com/events/past/')).toBe(true)
  })

  it('applies exact, prefix and RegExp excludes', () => {
    const { filter } = sitemapOptions({ distDir: dist, exclude: ['/login/', '/admin/*', /^\/drafts\//] })
    expect(filter('https://example.com/login/')).toBe(false)
    expect(filter('https://example.com/login-help/')).toBe(true)
    expect(filter('https://example.com/admin/')).toBe(false)
    expect(filter('https://example.com/admin/users/')).toBe(false)
    expect(filter('https://example.com/administration/')).toBe(true)
    expect(filter('https://example.com/drafts/one/')).toBe(false)
  })

  it('refuses an exclude that is not a path', () => {
    expect(() => sitemapOptions({ exclude: ['admin'] })).toThrow(/starting with \//)
  })
})

describe('hasNoindex', () => {
  it('reads robots and googlebot meta tags in any attribute order and case', () => {
    expect(hasNoindex('<meta name="robots" content="noindex, follow">')).toBe(true)
    expect(hasNoindex('<META CONTENT="NOINDEX" NAME="ROBOTS">')).toBe(true)
    expect(hasNoindex('<meta name="googlebot" content="none">')).toBe(true)
    expect(hasNoindex('<meta name=robots content=noindex>')).toBe(true)
  })

  it('ignores other tags and indexable robots values', () => {
    expect(hasNoindex('<meta name="robots" content="index, follow">')).toBe(false)
    expect(hasNoindex('<meta name="description" content="noindex is a word">')).toBe(false)
    expect(hasNoindex('<p>noindex</p>')).toBe(false)
  })
})
