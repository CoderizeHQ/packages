// robots.txt is the same on a preview and in production, on purpose.
//
// A preview (<name>.coderize.dev) is kept out of search by the `X-Robots-Tag: noindex` header
// its CloudFront distribution sends (`noindex: true` in coderize-infra sites.js), not by
// robots.txt. Two reasons:
//   - A crawler that robots.txt blocks never fetches the page, so it never sees the noindex,
//     and a linked preview URL can still be indexed ("Indexed, though blocked by robots.txt").
//   - A preview-only `Disallow: /` is what shipped to production on greensdeerranchzoo.com
//     (2026-09-24): the site launched blocked and nothing failed but the impressions.
// So `User-agent: *` is never disallowed site-wide, and the preview check below only adds a
// comment saying where the noindex comes from.

const PREVIEW_SUFFIX = '.coderize.dev'
// Production hosts under coderize.dev, not previews.
const NOT_PREVIEWS = new Set(['apps.coderize.dev', 'www.coderize.dev'])

/**
 * Whether a site URL is a Coderize preview host (`<name>.coderize.dev`). The bare `coderize.dev`,
 * `www.coderize.dev` and `apps.coderize.dev` are production sites, not previews.
 *
 * @param {string | URL | undefined} site
 * @returns {boolean}
 */
export function isPreviewHost(site) {
  if (!site) return false
  const { hostname } = new URL(site)
  return hostname.endsWith(PREVIEW_SUFFIX) && !NOT_PREVIEWS.has(hostname)
}

/**
 * The robots.txt body.
 *
 * @param {object} options
 * @param {string | URL} [options.site] the site URL (Astro's `site`); needed for the Sitemap line
 * @param {boolean} [options.preview] override the `*.coderize.dev` check (a production site on a
 *   coderize.dev subdomain passes false); it only changes the comment
 * @param {string[]} [options.disallow] paths every crawler should skip (`/admin`); never `/`
 * @param {string[]} [options.blockAgents] user agents refused the whole site (`CCBot`,
 *   `Bytespider`): training consent is the client's call, so none by default
 * @param {string | false} [options.sitemap] the sitemap path, `sitemap-index.xml` by default;
 *   false leaves the line out
 * @returns {string}
 */
export function robotsTxt({ site, preview, disallow = [], blockAgents = [], sitemap = 'sitemap-index.xml' } = {}) {
  for (const path of disallow) {
    if (typeof path !== 'string' || !path.startsWith('/')) {
      throw new TypeError(`robotsTxt: disallow entries are paths starting with / (got ${JSON.stringify(path)})`)
    }
    if (path === '/' || path === '/*') {
      throw new Error(
        'robotsTxt: "Disallow: /" for every crawler is never right. A preview is kept out of search by its ' +
          'X-Robots-Tag noindex header, and a blocked crawler cannot see that header.'
      )
    }
  }

  const lines = []
  if (preview ?? isPreviewHost(site)) {
    lines.push(
      '# Preview host: kept out of search by the X-Robots-Tag noindex header, not by this file,',
      '# so crawlers may fetch pages and see it.',
      ''
    )
  }

  lines.push('User-agent: *')
  if (disallow.length) lines.push(...disallow.map((path) => `Disallow: ${path}`))
  else lines.push('Allow: /')

  for (const agent of blockAgents) {
    lines.push('', `User-agent: ${agent}`, 'Disallow: /')
  }

  if (sitemap !== false) {
    if (!site) throw new TypeError('robotsTxt: pass `site` (set `site` in astro.config.mjs) or `sitemap: false`')
    lines.push('', `Sitemap: ${new URL(sitemap, site).href}`)
  }

  return `${lines.join('\n')}\n`
}

/**
 * A `GET` handler for `src/pages/robots.txt.js`, using the site URL from Astro's config.
 *
 * ```js
 * export const GET = robotsEndpoint({ disallow: ['/admin'] })
 * ```
 *
 * @param {Omit<Parameters<typeof robotsTxt>[0], 'site'>} [options]
 * @returns {(context: { site?: URL }) => Response}
 */
export function robotsEndpoint(options = {}) {
  return ({ site }) =>
    new Response(robotsTxt({ ...options, site }), {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    })
}
