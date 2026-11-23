// The fleet's canonical URL form: no trailing slash on any page, the root stays `/`
// (astro-site-standards). Astro's directory build reports `/about/` for /about, and the
// CloudFront router 301s `/about/` to `/about`, so a canonical or sitemap URL with the
// slash points search engines at a redirect.

/**
 * Drops trailing slashes from a path. The root stays `/`.
 *
 * @param {string} path
 * @returns {string}
 */
export function stripTrailingSlash(path) {
  return path.replace(/\/+$/, '') || '/'
}

/**
 * The canonical form of a page URL: absolute, no trailing slash (root exempt), no query
 * string and no fragment.
 *
 * @param {string | URL} pathOrUrl a path (`/about/`) resolved against `site`, or an absolute URL
 * @param {string | URL} [site] the site's origin, from Astro's `site` config; needed for a path
 * @returns {string}
 */
export function canonicalUrl(pathOrUrl, site) {
  if (pathOrUrl === undefined || pathOrUrl === null || pathOrUrl === '') {
    throw new TypeError('canonicalUrl needs a path or URL')
  }
  let url
  try {
    url = new URL(pathOrUrl, site)
  } catch {
    throw new TypeError(
      `canonicalUrl could not resolve "${pathOrUrl}"${site ? ` against "${site}"` : ': pass the site URL for a path'}`
    )
  }
  url.pathname = stripTrailingSlash(url.pathname)
  url.search = ''
  url.hash = ''
  return url.href
}
