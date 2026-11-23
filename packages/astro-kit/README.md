# @coderizehq/astro-kit

The head and crawl behaviour every Coderize Astro site carries a copy of: the canonical URL in the fleet's
no-trailing-slash form, Open Graph and Twitter tags, the `@astrojs/sitemap` options, robots.txt, JSON-LD output
and builders, and the Google Tag Manager loader with an event helper. No styles and no visual components: a
client's design is bespoke, so this package only writes `<head>` tags, config and data.

```bash
pnpm add @coderizehq/astro-kit
```

Peer dependency: `astro` 7. Plain JavaScript (ESM). Each piece works on its own, so a site can move onto them
one at a time.

| Import                                                 | What it is                                                                       |
| ------------------------------------------------------ | -------------------------------------------------------------------------------- |
| `@coderizehq/astro-kit/SeoHead.astro`                  | title, description, canonical, `og:*`, `twitter:*`, robots noindex               |
| `@coderizehq/astro-kit/sitemap`                        | `sitemapOptions()` for `@astrojs/sitemap` (config time only, reads `dist`)       |
| `@coderizehq/astro-kit` `robotsEndpoint`               | robots.txt as an endpoint                                                        |
| `@coderizehq/astro-kit/JsonLd.astro`                   | one escaped `<script type="application/ld+json">`                                |
| `@coderizehq/astro-kit` builders                       | `organization`, `localBusiness`, `breadcrumbList`, `faqPage`, `event`, `website` |
| `@coderizehq/astro-kit/Gtm.astro`, `GtmNoscript.astro` | the GTM loader and its noscript iframe, production builds only                   |
| `@coderizehq/astro-kit/track`, or the main entry       | `track(event, params)`: one `dataLayer.push`                                     |

## All together

```astro
---
// src/layout/Base.astro
import SeoHead from '@coderizehq/astro-kit/SeoHead.astro'
import JsonLd from '@coderizehq/astro-kit/JsonLd.astro'
import Gtm from '@coderizehq/astro-kit/Gtm.astro'
import GtmNoscript from '@coderizehq/astro-kit/GtmNoscript.astro'
import { organization, website } from '@coderizehq/astro-kit'
import { site } from '@/config/site.js'

const { title, description = site.description, image, noindex = false } = Astro.props
const gtmId = import.meta.env.PUBLIC_GTM_ID
---

<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <SeoHead
      title={title ? `${title} · ${site.name}` : site.name}
      description={description}
      image={image}
      defaultImage="/og-default.png"
      siteName={site.name}
      noindex={noindex}
    />
    <Gtm id={gtmId} />
    <JsonLd
      data={[
        organization({ name: site.name, url: site.url, logo: `${site.url}/logo.png` }),
        website({ name: site.name, url: site.url, publisher: `${site.url}/#organization` }),
      ]}
    />
  </head>
  <body>
    <GtmNoscript id={gtmId} />
    <slot />
  </body>
</html>
```

```js
// astro.config.mjs
import { defineConfig } from 'astro/config'
import sitemap from '@astrojs/sitemap'
import { sitemapOptions } from '@coderizehq/astro-kit/sitemap'

export default defineConfig({
  site: 'https://example.com',
  trailingSlash: 'ignore',
  integrations: [sitemap(sitemapOptions({ exclude: ['/admin/*'] }))],
})
```

```js
// src/pages/robots.txt.js (and delete public/robots.txt)
import { robotsEndpoint } from '@coderizehq/astro-kit'

export const GET = robotsEndpoint()
```

`site` must be set in `astro.config.mjs`: every URL here is built from it.

## The URL rule

The canonical form of a page URL has **no trailing slash** (`/events`); the root stays `/`, files keep their
extension (`/sitemap-index.xml`). The fleet's CloudFront router 301s `/events/` to `/events`, so a canonical
or sitemap URL with the slash points search engines at a redirect (`astro-site-standards`).

`canonicalUrl(pathOrUrl, site)` returns that form: absolute, slash stripped (root exempt), no query string, no
fragment. `stripTrailingSlash(path)` is the path half of it.

```js
canonicalUrl('/events/', 'https://example.com') // 'https://example.com/events'
canonicalUrl('https://example.com/') // 'https://example.com/'
```

## `<SeoHead>`

Put it in `<head>` after `charset` and `viewport`.

| Prop                                    | Writes                                                                                 |
| --------------------------------------- | -------------------------------------------------------------------------------------- |
| `title` (required)                      | `<title>`, `og:title`, `twitter:title`. The full string: the site adds its suffix.     |
| `description`                           | `description`, `og:description`, `twitter:description`                                 |
| `canonical`                             | overrides the canonical: a path or absolute URL, normalised the same way               |
| `image`, `defaultImage`                 | `og:image`, `twitter:image`, absolute. `image` wins; `defaultImage` is the site's card |
| `imageAlt`, `imageWidth`, `imageHeight` | `og:image:alt` / `twitter:image:alt`, `og:image:width`, `og:image:height`              |
| `type`                                  | `og:type`, `website` by default                                                        |
| `siteName`, `locale`, `twitterSite`     | `og:site_name`, `og:locale`, `twitter:site`                                            |
| `twitterCard`                           | `twitter:card`: `summary` or `summary_large_image`; the default is below               |
| `noindex`, `nofollow`                   | `<meta name="robots" content="noindex">` (and/or `nofollow`)                           |

**The canonical is the page's own URL.** Without a `canonical` prop it comes from `Astro.url.pathname` with the
slash stripped. It never falls back to the home URL: eight fleet sites built theirs from a per-page prop that
defaulted to the home page, so any page that forgot the prop told Google it was a copy of the home page.

**A noindex page gets no canonical** unless you pass one: a page asking not to be indexed and naming a URL to
index sends two signals. Use `noindex` for the 404 page, thank-you pages and forwarders, and keep them out of the
sitemap (the sitemap options below do that for you).

`twitter:card` is `summary_large_image` when there is an image and `summary` when there isn't. Pass
`twitterCard="summary"` for a small square card beside the text (a logo as the site's card, a profile photo), or
`summary_large_image` to ask for the large card regardless. Any other value throws at build time.

**Previews are not this component's job.** A `<name>.coderize.dev` preview is kept out of search by the
`X-Robots-Tag: noindex` header its distribution sends (`noindex: true` in `coderize-infra` `sites.js`), never
by a meta tag in the build: the same build later serves the real domain.

## `sitemapOptions()`

```js
sitemap(
  sitemapOptions({
    exclude: ['/login', '/admin/*', /^\/drafts\//],
    lastmod: 'build',
  }),
)
```

It returns `{ filter, serialize }` for `@astrojs/sitemap`:

- **`serialize`** strips the trailing slash from every URL (root exempt) and sets `lastmod`. Other fields the
  integration sets pass through.
- **`filter`** leaves out `exclude` paths and every page whose **built HTML** carries a robots `noindex` (or
  `none`) meta tag. The sitemap is written after the pages, so the HTML is the authority, and a noindexed page
  needs no second list to keep in step (the xceptionalheroes approach).

| Option        | Default   | Meaning                                                                                                                                     |
| ------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `exclude`     | `[]`      | `'/login'` (that page), `'/admin/*'` (/admin and everything under it), or a RegExp on the path                                              |
| `lastmod`     | `'build'` | `'build'`: one build timestamp on every URL. `'none'`: no lastmod. A function `(url) => Date \| string \| undefined` for dates from content |
| `skipNoindex` | `true`    | read the build for noindex pages                                                                                                            |
| `distDir`     | `'dist'`  | the build output, a path from the working directory or a `URL`. Set it if `outDir` moves                                                    |

`changefreq` and `priority` are not set: Google ignores both.

**Both fleet recipes work.** Recipe A (`trailingSlash: 'ignore'`) needs the strip, and this is it. Recipe B
(`trailingSlash: 'never'`) already gets no-slash URLs from the integration, and the strip changes nothing.
Don't flip a Recipe B site to `'ignore'` while adopting this; that is a separate, paired change
(`astro-site-standards` §1). Never `trailingSlash: 'always'`.

## robots.txt

```js
// src/pages/robots.txt.js
import { robotsEndpoint } from '@coderizehq/astro-kit'

export const GET = robotsEndpoint({ disallow: ['/admin'], blockAgents: ['CCBot', 'Bytespider'] })
```

```text
User-agent: *
Disallow: /admin

User-agent: CCBot
Disallow: /

User-agent: Bytespider
Disallow: /

Sitemap: https://example.com/sitemap-index.xml
```

With no options it is `User-agent: *`, `Allow: /` and the sitemap. `robotsTxt(options)` returns the same text
as a string.

| Option        | Default               | Meaning                                                                               |
| ------------- | --------------------- | ------------------------------------------------------------------------------------- |
| `disallow`    | `[]`                  | paths every crawler skips. `/` and `/*` are refused (below)                           |
| `blockAgents` | `[]`                  | user agents refused the whole site. Training consent is the client's call (`seo-geo`) |
| `sitemap`     | `'sitemap-index.xml'` | the sitemap path on the site, or `false` for no Sitemap line                          |
| `preview`     | host check            | force the preview comment on or off                                                   |

**The file is the same on a preview and in production.** The fleet keeps previews out of search with the
`X-Robots-Tag: noindex` response header, and robots.txt must let crawlers through to see it: a crawler that
robots.txt blocks never fetches the page, never sees the noindex, and can still index the URL from links
("Indexed, though blocked by robots.txt"). A preview-only `Disallow: /` is also exactly what launched
greensdeerranchzoo.com blocked from search in 2026. So `robotsTxt` throws on `Disallow: /` for every crawler,
and the preview check (`isPreviewHost(site)`: any `*.coderize.dev` host except `www.coderize.dev` and
`apps.coderize.dev`, which are production) only adds a comment saying where the
noindex comes from. A production site on a coderize.dev subdomain can pass `preview: false` to drop the comment;
nothing else changes either way.

## `<JsonLd>` and the builders

```astro
---
import JsonLd from '@coderizehq/astro-kit/JsonLd.astro'
import { breadcrumbList, localBusiness } from '@coderizehq/astro-kit'
---

<JsonLd data={localBusiness({ type: 'InsuranceAgency', name: site.name, url: site.url, address: site.address })} />
<JsonLd
  data={breadcrumbList({
    site: Astro.site,
    items: [
      { name: 'Home', path: '/' },
      { name: 'Services', path: '/services' },
    ],
  })}
/>
```

`<JsonLd data>` writes one script per call. `data` is a node or an array of nodes; an array becomes one
`@graph`, and `@context` is added for you. `null` or `[]` renders nothing. Every `<` in the output is written as
`<`, so a value containing `</script>` cannot end the tag (41 of 47 fleet sites didn't escape; on an SSR
site with API data that is a stored XSS). `serializeJsonLd(data)` is the same string, for code outside a
component.

The builders return plain nodes without `@context`. Business data stays in each site; the builders only give
the shape. Any property they don't name passes through as Schema.org.

| Builder                                                                 | Notes                                                                                                                                  |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `organization({ name, url, logo, sameAs })`                             | `@id` defaults to `<origin>/#organization`                                                                                             |
| `localBusiness({ type, name, url, address, geo, hours, telephone, … })` | `type` is the subtype (`Dentist`); `@id` `<origin>/#localbusiness`; `hours` is `[{ days, opens, closes }]`                             |
| `breadcrumbList({ site, items })`                                       | `items` is `[{ name, path }]`; positions from 1, absolute no-slash URLs                                                                |
| `faqPage({ items })`                                                    | `items` is `[{ question, answer }]`. No rich result since 2026-05-07; kept for AI answers                                              |
| `event({ name, startDate, location, … })`                               | dates as ISO strings or `Date`; `location` `{ name, address }` becomes a Place; `eventStatus` and `attendanceMode` take the short name |
| `website({ name, url, publisher })`                                     | `publisher` as a string is an `@id` reference                                                                                          |
| `postalAddress({ street, city, region, postalCode, country })`          | `country` defaults to `US`                                                                                                             |

URL fields (`url`, `logo`, `image`) must be absolute, and the builders throw on a relative one. Required fields
missing also throw, at build time, rather than shipping incomplete markup.

## Google Tag Manager

```astro
<head>
  <Gtm id={import.meta.env.PUBLIC_GTM_ID} />
</head>
<body>
  <GtmNoscript id={import.meta.env.PUBLIC_GTM_ID} />
```

Both render only in a **production build** with a container id, so `astro dev` and a build without
`PUBLIC_GTM_ID` send nothing to the site's GA4 property. The id must look like `GTM-XXXXXXX`; anything else
throws, since it lands in an inline script. The loader is `is:inline`, so Astro doesn't bundle and defer it.
The noscript iframe is its own component because it belongs at the start of `<body>`: a `<noscript>` holding an
iframe isn't valid in `<head>`.

Each site has its own container in the Coderize Clients GTM account, which carries the GA4 tag. No gtag shim is
included (below).

### `track(event, params)`

```js
import { track } from '@coderizehq/astro-kit/track'

track('click_phone', { link_location: 'header' })
```

It pushes `{ ...params, event }` onto `window.dataLayer` (creating it if GTM hasn't loaded yet), and does
nothing outside a browser. In the container, a Custom Event trigger on the event name fires a GA4 Event tag
that reads the parameters as Data Layer Variables: the setup live on sweeteninsurance.com since 2026-10-27.

**One convention: `dataLayer.push`, not `gtag('event', …)`.** The fleet had both. `gtag` calls only reach GA4
through a gtag shim plus a Google tag configured to read them, and they vanish without an error when either is
missing; they also bypass GTM's triggers, which is where the fleet manages tags. A site moving from `gtag` calls
changes them to `track()` and adds the matching trigger and tag in its container in the same change.

## Testing

`pnpm test` renders the components with Astro's container API (`vitest.config.js` uses `getViteConfig`) and
unit-tests the helpers.
