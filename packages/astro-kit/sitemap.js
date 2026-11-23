import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { canonicalUrl } from './canonical.js'

/**
 * Options for `@astrojs/sitemap`: every URL in the fleet's no-trailing-slash form, and no page
 * that asks not to be indexed.
 *
 * ```js
 * sitemap(sitemapOptions({ exclude: ['/admin/*'] }))
 * ```
 *
 * Works for both fleet recipes. With `trailingSlash: 'ignore'` (Recipe A) the strip is what
 * keeps the slash out; with `trailingSlash: 'never'` (Recipe B) the URLs arrive without one and
 * the strip changes nothing.
 *
 * @param {object} [options]
 * @param {Array<string | RegExp>} [options.exclude] paths to leave out: `/login` (that page only),
 *   `/admin/*` (everything under /admin, and /admin itself), or a RegExp tested against the path
 * @param {'build' | 'none' | ((url: string) => Date | string | undefined)} [options.lastmod] `build`
 *   (default) stamps every URL with the build time, `none` emits no lastmod, a function returns
 *   the date for one URL (or undefined for none)
 * @param {boolean} [options.skipNoindex] leave out pages whose built HTML carries a robots
 *   `noindex` meta tag (default true)
 * @param {string | URL} [options.distDir] the build output, read for the noindex check
 *   (default `dist` in the working directory, which is the app folder under `pnpm build`)
 * @returns {{ filter: (page: string) => boolean, serialize: (item: { url: string }) => object }}
 */
export function sitemapOptions({ exclude = [], lastmod = 'build', skipNoindex = true, distDir = 'dist' } = {}) {
  const lastmodFor = lastmodResolver(lastmod)
  const dist = typeof distDir === 'string' ? resolve(distDir) : fileURLToPath(distDir)
  const excluded = exclude.map(pathMatcher)

  return {
    filter(page) {
      const path = new URL(canonicalUrl(page)).pathname
      if (excluded.some((matches) => matches(path))) return false
      return !(skipNoindex && isNoindexPage(dist, path))
    },
    serialize(item) {
      const url = canonicalUrl(item.url)
      const date = lastmodFor(url)
      const { lastmod: _dropped, ...rest } = item
      return date === undefined ? { ...rest, url } : { ...rest, url, lastmod: date }
    }
  }
}

function lastmodResolver(lastmod) {
  if (lastmod === 'none') return () => undefined
  if (lastmod === 'build') {
    // One timestamp for the whole build, so every URL in a deploy carries the same date.
    const builtAt = new Date().toISOString()
    return () => builtAt
  }
  if (typeof lastmod === 'function') {
    return (url) => {
      const value = lastmod(url)
      return value instanceof Date ? value.toISOString() : (value ?? undefined)
    }
  }
  throw new TypeError(`sitemapOptions: lastmod must be 'build', 'none' or a function (got ${JSON.stringify(lastmod)})`)
}

function pathMatcher(pattern) {
  if (pattern instanceof RegExp) return (path) => pattern.test(path)
  if (typeof pattern !== 'string' || !pattern.startsWith('/')) {
    throw new TypeError(`sitemapOptions: exclude entries are paths starting with / or RegExps (got ${pattern})`)
  }
  if (pattern.endsWith('/*')) {
    const base = pattern.slice(0, -2) || '/'
    return (path) => path === base || path.startsWith(base === '/' ? '/' : `${base}/`)
  }
  const exact = new URL(canonicalUrl(pattern, 'https://x.invalid')).pathname
  return (path) => path === exact
}

// The sitemap integration runs after every page is written, so the built HTML is the
// authority on noindex: a page that sets it is left out without a second list to keep in step.
function isNoindexPage(dist, path) {
  const dir = decodeURIComponent(path).replace(/^\/+/, '')
  const candidates = dir ? [`${dir}/index.html`, `${dir}.html`] : ['index.html']
  for (const file of candidates) {
    let html
    try {
      html = readFileSync(resolve(dist, file), 'utf8')
    } catch {
      continue
    }
    return hasNoindex(html)
  }
  return false
}

/**
 * Whether an HTML document tells search engines not to index it: a `robots` or `googlebot`
 * meta tag whose content holds `noindex` or `none`.
 *
 * @param {string} html
 * @returns {boolean}
 */
export function hasNoindex(html) {
  for (const [tag] of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = attributes(tag)
    if (!/^(robots|googlebot)$/i.test(attrs.name ?? '')) continue
    if (/(^|[\s,])(noindex|none)($|[\s,])/i.test(attrs.content ?? '')) return true
  }
  return false
}

function attributes(tag) {
  const attrs = {}
  for (const match of tag.matchAll(/([^\s=/<>"']+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+))/g)) {
    attrs[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4]
  }
  return attrs
}
