# Changelog

Moved here from CoderizeDEV/coderize-platform (`packages/astro-kit` at c60309c) and renamed `@coderizehq/astro-kit`. The entries from 0.2.0 down are `@coderize/astro-kit`'s, released from that repo with Changesets; its git history stays there.

## 1.0.0 (2026-11-24)


### Features

* move the [@coderize](https://github.com/coderize) packages here as @coderizehq/* ([#16](https://github.com/CoderizeHQ/packages/issues/16)) ([a4011d4](https://github.com/CoderizeHQ/packages/commit/a4011d4cf268b0262aa9c3b23c93503290b0c088))

## 0.2.0

### Minor Changes

- Add a `twitterCard` prop to `<SeoHead>` (`summary` or `summary_large_image`, anything else throws); without it the card is chosen as before, large with an image and `summary` without. `isPreviewHost` no longer counts `www.coderize.dev` and `apps.coderize.dev` as previews, so their robots.txt loses the preview comment without passing `preview: false`; the rules in it are unchanged.

## 0.1.1

### Patch Changes

- First release through the coderize-platform release workflow (npm trusted publishing). No code changes from 0.1.0.

## 0.1.0

### Minor Changes

- First release: `<SeoHead>` (title, description, a canonical derived from the page URL in the no-trailing-slash form with an override and no home-page fallback, Open Graph and Twitter tags, robots noindex), `sitemapOptions()` for `@astrojs/sitemap` (the slash strip, `lastmod`, and a filter for excluded paths and noindex pages read from the build), `robotsTxt()` and `robotsEndpoint()` (the same rules on previews and production, never `Disallow: /` for every crawler), `<JsonLd>` with `<`-escaped output and the `organization`, `localBusiness`, `breadcrumbList`, `faqPage`, `event`, `website` and `postalAddress` builders, `<Gtm>` and `<GtmNoscript>` (production builds with a container id only), and `track()` for GTM custom events through `dataLayer.push`. No styles or visual components.
