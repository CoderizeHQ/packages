import { experimental_AstroContainer as AstroContainer } from 'astro/container'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import Gtm from '../Gtm.astro'
import GtmNoscript from '../GtmNoscript.astro'
import JsonLd from '../JsonLd.astro'
import SeoHead from '../SeoHead.astro'

const SITE = 'https://example.com'
let container

beforeAll(async () => {
  container = await AstroContainer.create({ astroConfig: { site: SITE } })
})

afterEach(() => {
  vi.unstubAllEnvs()
})

const render = (component, { path = '/', props = {} } = {}) =>
  container.renderToString(component, { request: new Request(new URL(path, SITE)), props })

const all = (html, pattern) => [...html.matchAll(pattern)].map((match) => match[1])
const canonicals = (html) => all(html, /<link rel="canonical" href="([^"]*)"/g)
const meta = (html, key) => all(html, new RegExp(`<meta (?:name|property)="${key}" content="([^"]*)"`, 'g'))

describe('SeoHead', () => {
  it('derives the canonical from the page URL, without the trailing slash', async () => {
    const html = await render(SeoHead, { path: '/events/', props: { title: 'Events' } })
    expect(canonicals(html)).toEqual(['https://example.com/events'])
    expect(meta(html, 'og:url')).toEqual(['https://example.com/events'])
  })

  it('keeps the root as /', async () => {
    const html = await render(SeoHead, { props: { title: 'Home' } })
    expect(canonicals(html)).toEqual(['https://example.com/'])
  })

  it('never falls back to the home URL on another page', async () => {
    const html = await render(SeoHead, { path: '/about/team/', props: { title: 'Team' } })
    expect(canonicals(html)).toEqual(['https://example.com/about/team'])
  })

  it('takes an explicit canonical, as a path or a URL, and normalises it', async () => {
    const fromPath = await render(SeoHead, { path: '/blog/page/2/', props: { title: 'Blog', canonical: '/blog/' } })
    expect(canonicals(fromPath)).toEqual(['https://example.com/blog'])
    const fromUrl = await render(SeoHead, {
      path: '/copy/',
      props: { title: 'Copy', canonical: 'https://other.example/original/?utm_source=x' },
    })
    expect(canonicals(fromUrl)).toEqual(['https://other.example/original'])
  })

  it('writes title, description, Open Graph and Twitter tags', async () => {
    const html = await render(SeoHead, {
      path: '/about/',
      props: {
        title: 'About · Acme',
        description: 'Who we are & what we do',
        image: '/og/about.png',
        imageAlt: 'The team',
        imageWidth: 1200,
        imageHeight: 630,
        siteName: 'Acme',
        locale: 'en_US',
        twitterSite: '@acme',
      },
    })
    expect(html).toContain('<title>About · Acme</title>')
    expect(meta(html, 'description')).toEqual(['Who we are &amp; what we do'])
    expect(meta(html, 'og:type')).toEqual(['website'])
    expect(meta(html, 'og:title')).toEqual(['About · Acme'])
    expect(meta(html, 'og:site_name')).toEqual(['Acme'])
    expect(meta(html, 'og:locale')).toEqual(['en_US'])
    expect(meta(html, 'og:image')).toEqual(['https://example.com/og/about.png'])
    expect(meta(html, 'og:image:width')).toEqual(['1200'])
    expect(meta(html, 'og:image:height')).toEqual(['630'])
    expect(meta(html, 'og:image:alt')).toEqual(['The team'])
    expect(meta(html, 'twitter:card')).toEqual(['summary_large_image'])
    expect(meta(html, 'twitter:site')).toEqual(['@acme'])
    expect(meta(html, 'twitter:image')).toEqual(['https://example.com/og/about.png'])
    expect(meta(html, 'robots')).toEqual([])
  })

  it('falls back to the default image, and to a summary card with none', async () => {
    const withDefault = await render(SeoHead, { props: { title: 'Home', defaultImage: '/og-default.png' } })
    expect(meta(withDefault, 'og:image')).toEqual(['https://example.com/og-default.png'])
    const without = await render(SeoHead, { props: { title: 'Home' } })
    expect(meta(without, 'og:image')).toEqual([])
    expect(meta(without, 'twitter:card')).toEqual(['summary'])
  })

  it('lets a page choose its twitter card, keeping the image tags', async () => {
    const small = await render(SeoHead, { props: { title: 'Logo', image: '/logo.png', twitterCard: 'summary' } })
    expect(meta(small, 'twitter:card')).toEqual(['summary'])
    expect(meta(small, 'twitter:image')).toEqual(['https://example.com/logo.png'])
    const large = await render(SeoHead, { props: { title: 'Home', twitterCard: 'summary_large_image' } })
    expect(meta(large, 'twitter:card')).toEqual(['summary_large_image'])
  })

  it('refuses a twitter card it does not know', async () => {
    await expect(render(SeoHead, { props: { title: 'Home', twitterCard: 'player' } })).rejects.toThrow(/twitterCard/)
  })

  it('marks a noindex page and leaves out its canonical', async () => {
    const html = await render(SeoHead, { path: '/404', props: { title: 'Not found', noindex: true } })
    expect(meta(html, 'robots')).toEqual(['noindex'])
    expect(canonicals(html)).toEqual([])
  })

  it('keeps an explicit canonical on a noindex page, and adds nofollow when asked', async () => {
    const html = await render(SeoHead, {
      path: '/thanks/',
      props: { title: 'Thanks', noindex: true, nofollow: true, canonical: '/contact' },
    })
    expect(meta(html, 'robots')).toEqual(['noindex, nofollow'])
    expect(canonicals(html)).toEqual(['https://example.com/contact'])
  })

  it('refuses a page with no title', async () => {
    await expect(render(SeoHead, { path: '/x/' })).rejects.toThrow(/title/)
  })
})

describe('JsonLd', () => {
  const scripts = (html) => all(html, /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)

  it('writes one script per call, with @context, escaping < so nothing can close the tag', async () => {
    const html = await render(JsonLd, {
      props: { data: { '@type': 'Event', name: 'Bad </script><script>alert(1)</script>' } },
    })
    const [json, ...rest] = scripts(html)
    expect(rest).toEqual([])
    expect(json).not.toMatch(/<\/script/i)
    expect(JSON.parse(json)).toEqual({
      '@context': 'https://schema.org',
      '@type': 'Event',
      name: 'Bad </script><script>alert(1)</script>',
    })
  })

  it('wraps an array of nodes in one @graph', async () => {
    const html = await render(JsonLd, { props: { data: [{ '@type': 'Organization' }, { '@type': 'WebSite' }] } })
    const parsed = scripts(html).map((json) => JSON.parse(json))
    expect(parsed).toEqual([
      { '@context': 'https://schema.org', '@graph': [{ '@type': 'Organization' }, { '@type': 'WebSite' }] },
    ])
  })

  it('escapes every node of an array, and drops a node’s own @context inside the @graph', async () => {
    const html = await render(JsonLd, {
      props: {
        data: [
          { '@context': 'https://schema.org', '@type': 'Organization', name: 'A </script><script>alert(1)</script>' },
          { '@type': 'WebSite', description: '<!-- not a comment -->' },
        ],
      },
    })
    const [json, ...rest] = scripts(html)
    expect(rest).toEqual([])
    expect(json).not.toMatch(/<\/script|<!--/i)
    expect(JSON.parse(json)).toEqual({
      '@context': 'https://schema.org',
      '@graph': [
        { '@type': 'Organization', name: 'A </script><script>alert(1)</script>' },
        { '@type': 'WebSite', description: '<!-- not a comment -->' },
      ],
    })
  })

  it('renders nothing for null or an empty list, and refuses missing data', async () => {
    expect(scripts(await render(JsonLd, { props: { data: null } }))).toEqual([])
    expect(scripts(await render(JsonLd, { props: { data: [] } }))).toEqual([])
    await expect(render(JsonLd)).rejects.toThrow(/data/)
  })
})

describe('Gtm and GtmNoscript', () => {
  it('render nothing outside a production build', async () => {
    vi.stubEnv('PROD', false)
    expect(await render(Gtm, { props: { id: 'GTM-ABC123' } })).not.toContain('googletagmanager')
    expect(await render(GtmNoscript, { props: { id: 'GTM-ABC123' } })).not.toContain('googletagmanager')
  })

  it('render nothing in production without a container id', async () => {
    vi.stubEnv('PROD', true)
    expect(await render(Gtm, { props: { id: '' } })).toBe('')
    expect(await render(GtmNoscript)).toBe('')
  })

  it('load the container in production', async () => {
    vi.stubEnv('PROD', true)
    const head = await render(Gtm, { props: { id: 'GTM-ABC123' } })
    expect(head).toMatch(/^<script>\(function\(w,d,s,l,i\)/)
    expect(head).toContain(`'script','dataLayer',"GTM-ABC123");</script>`)
    const body = await render(GtmNoscript, { props: { id: 'GTM-ABC123' } })
    expect(body).toContain('<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=GTM-ABC123"')
    expect(body).toContain('style="display:none;visibility:hidden"')
  })

  it('refuse anything that is not a container id, since it lands in an inline script', async () => {
    vi.stubEnv('PROD', true)
    await expect(render(Gtm, { props: { id: "GTM-1');alert(1);('" } })).rejects.toThrow(/container id/)
    await expect(render(GtmNoscript, { props: { id: 'G-ABC123' } })).rejects.toThrow(/container id/)
  })
})
