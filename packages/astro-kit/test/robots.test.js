import { describe, expect, it } from 'vitest'

import { isPreviewHost, robotsEndpoint, robotsTxt } from '../robots.js'

describe('isPreviewHost', () => {
  it('knows the coderize.dev preview hosts', () => {
    expect(isPreviewHost('https://whitefeatherfarm.coderize.dev')).toBe(true)
    expect(isPreviewHost(new URL('https://stcf.coderize.dev/'))).toBe(true)
    expect(isPreviewHost('https://coderize.dev')).toBe(false)
    expect(isPreviewHost('https://example.com')).toBe(false)
    expect(isPreviewHost('https://notcoderize.dev')).toBe(false)
    expect(isPreviewHost(undefined)).toBe(false)
  })

  it('does not count the production coderize.dev hosts as previews', () => {
    expect(isPreviewHost('https://apps.coderize.dev')).toBe(false)
    expect(isPreviewHost('https://www.coderize.dev/')).toBe(false)
    expect(isPreviewHost('https://APPS.coderize.dev')).toBe(false)
  })
})

describe('robotsTxt', () => {
  it('allows everything and points at the sitemap by default', () => {
    expect(robotsTxt({ site: 'https://example.com' })).toBe(
      'User-agent: *\nAllow: /\n\nSitemap: https://example.com/sitemap-index.xml\n'
    )
  })

  it('serves a preview the same rules, with a comment on where its noindex comes from', () => {
    const body = robotsTxt({ site: 'https://acme.coderize.dev' })
    expect(body).toMatch(/^# Preview host: kept out of search by the X-Robots-Tag noindex header/)
    expect(body).toContain('User-agent: *\nAllow: /\n')
    expect(body).toContain('Sitemap: https://acme.coderize.dev/sitemap-index.xml')
    expect(body).not.toMatch(/Disallow: \/\n/)
  })

  it('gives a real domain exactly what it got before, whatever previews get', () => {
    for (const site of ['https://example.com', 'https://greensdeerranchzoo.com/', 'https://apps.coderize.dev']) {
      const origin = new URL(site).origin
      expect(robotsTxt({ site })).toBe(`User-agent: *\nAllow: /\n\nSitemap: ${origin}/sitemap-index.xml\n`)
    }
  })

  it('never disallows the whole site for every crawler on a preview either', () => {
    const body = robotsTxt({ site: 'https://acme.coderize.dev', disallow: ['/admin'], blockAgents: ['CCBot'] })
    const everyone = body.split('\n\n').find((block) => block.includes('User-agent: *'))
    expect(everyone).toBe('User-agent: *\nDisallow: /admin')
  })

  it('lets the preview check be overridden', () => {
    expect(robotsTxt({ site: 'https://apps.coderize.dev', preview: false })).not.toContain('#')
    expect(robotsTxt({ site: 'https://example.com', preview: true })).toMatch(/^# Preview host/)
  })

  it('disallows listed paths and blocks listed agents', () => {
    expect(
      robotsTxt({ site: 'https://example.com', disallow: ['/admin', '/api/'], blockAgents: ['CCBot', 'Bytespider'] })
    ).toBe(
      [
        'User-agent: *',
        'Disallow: /admin',
        'Disallow: /api/',
        '',
        'User-agent: CCBot',
        'Disallow: /',
        '',
        'User-agent: Bytespider',
        'Disallow: /',
        '',
        'Sitemap: https://example.com/sitemap-index.xml',
        ''
      ].join('\n')
    )
  })

  it('refuses to disallow the whole site for every crawler', () => {
    expect(() => robotsTxt({ site: 'https://example.com', disallow: ['/'] })).toThrow(/X-Robots-Tag/)
    expect(() => robotsTxt({ site: 'https://example.com', disallow: ['/*'] })).toThrow(/X-Robots-Tag/)
    expect(() => robotsTxt({ site: 'https://example.com', disallow: ['admin'] })).toThrow(/starting with \//)
  })

  it('takes another sitemap path, or none', () => {
    expect(robotsTxt({ site: 'https://example.com', sitemap: '/sitemap.xml' })).toContain(
      'Sitemap: https://example.com/sitemap.xml'
    )
    expect(robotsTxt({ sitemap: false })).toBe('User-agent: *\nAllow: /\n')
    expect(() => robotsTxt({})).toThrow(/site/)
  })
})

describe('robotsEndpoint', () => {
  it('answers text/plain built from the site in the endpoint context', async () => {
    const GET = robotsEndpoint({ disallow: ['/admin'] })
    const response = GET({ site: new URL('https://example.com/') })
    expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8')
    expect(await response.text()).toBe(
      'User-agent: *\nDisallow: /admin\n\nSitemap: https://example.com/sitemap-index.xml\n'
    )
  })
})
