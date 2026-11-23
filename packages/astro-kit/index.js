// Everything but the sitemap options, which read the build output with node:fs and are only
// for astro.config.mjs: import those from '@coderizehq/astro-kit/sitemap'.
export { canonicalUrl, stripTrailingSlash } from './canonical.js'
export { isPreviewHost, robotsEndpoint, robotsTxt } from './robots.js'
export {
  breadcrumbList,
  event,
  faqPage,
  localBusiness,
  organization,
  postalAddress,
  serializeJsonLd,
  website,
} from './schema.js'
export { track } from './track.js'
