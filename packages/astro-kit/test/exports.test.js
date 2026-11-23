import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))

describe('package exports', () => {
  it('serves the helpers from the main entry', async () => {
    const kit = await import('@coderizehq/astro-kit')
    expect(Object.keys(kit).sort()).toEqual([
      'breadcrumbList',
      'canonicalUrl',
      'event',
      'faqPage',
      'isPreviewHost',
      'localBusiness',
      'organization',
      'postalAddress',
      'robotsEndpoint',
      'robotsTxt',
      'serializeJsonLd',
      'stripTrailingSlash',
      'track',
      'website',
    ])
  })

  it('serves the sitemap options from their own entry', async () => {
    const sitemap = await import('@coderizehq/astro-kit/sitemap')
    expect(Object.keys(sitemap).sort()).toEqual(['hasNoindex', 'sitemapOptions'])
  })

  it('keeps node:fs out of the main entry, which can end up in a browser bundle', async () => {
    for (const file of ['index.js', 'canonical.js', 'robots.js', 'schema.js', 'track.js']) {
      const source = await readFile(new URL(`../${file}`, import.meta.url), 'utf8')
      expect(source, file).not.toMatch(/from 'node:|from '\.\/sitemap\.js'/)
    }
  })

  it('publishes every file it exports', () => {
    for (const target of Object.values(pkg.exports)) {
      const file = target.replace(/^\.\//, '')
      if (file !== 'package.json') expect(pkg.files).toContain(file)
    }
    for (const file of ['canonical.js', 'robots.js', 'schema.js']) expect(pkg.files).toContain(file)
  })
})
