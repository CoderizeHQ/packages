import { canonicalUrl } from './canonical.js'

// Generic Schema.org JSON-LD builders. They return plain nodes without `@context`; <JsonLd>
// (or serializeJsonLd) adds it, and wraps an array of nodes in one `@graph`. Business data
// (names, NAP, hours, offers) stays in each site: these only give the shape.

const CONTEXT = 'https://schema.org'

/**
 * JSON-LD as a string that is safe inside `<script type="application/ld+json">`. Every `<`
 * becomes `<`, so a value holding `</script>` or `<!--` cannot end or confuse the tag.
 * An array of nodes becomes one `@graph`.
 *
 * @param {object | object[]} data
 * @returns {string}
 */
export function serializeJsonLd(data) {
  if (!data || typeof data !== 'object') throw new TypeError('serializeJsonLd needs an object or an array of nodes')
  return JSON.stringify(withContext(data)).replace(/</g, '\\u003c')
}

function withContext(data) {
  if (Array.isArray(data)) {
    return {
      '@context': CONTEXT,
      '@graph': data.map((node) => {
        const { '@context': _dropped, ...rest } = node
        return rest
      })
    }
  }
  return data['@context'] ? data : { '@context': CONTEXT, ...data }
}

/**
 * A NAP address as a PostalAddress. An object that already has `@type` passes through.
 *
 * @param {{ street?: string, city?: string, region?: string, postalCode?: string, country?: string }} address
 */
export function postalAddress(address) {
  if (!address || address['@type']) return address
  const { street, city, region, postalCode, country = 'US' } = address
  return compact({
    '@type': 'PostalAddress',
    streetAddress: street,
    addressLocality: city,
    addressRegion: region,
    postalCode,
    addressCountry: country
  })
}

/**
 * @param {{ name: string, url: string, id?: string, logo?: string, sameAs?: string[] } & Record<string, unknown>} options
 *   any other property passes through as Schema.org
 */
export function organization({ name, url, id, logo, sameAs, ...rest }) {
  required('organization', { name, url })
  return compact({
    '@type': 'Organization',
    '@id': id ?? nodeId(url, 'organization'),
    name,
    url: absolute('organization', 'url', url),
    logo: logo && absolute('organization', 'logo', logo),
    sameAs: nonEmpty(sameAs),
    ...rest
  })
}

/**
 * @param {{
 *   name: string, url: string, type?: string | string[], id?: string,
 *   address?: object, telephone?: string, email?: string, image?: string, priceRange?: string,
 *   geo?: { latitude: number | string, longitude: number | string },
 *   hours?: Array<{ days: string[], opens: string, closes: string }>,
 *   sameAs?: string[]
 * } & Record<string, unknown>} options `type` is the subtype (`Dentist`, `InsuranceAgency`);
 *   any other property passes through as Schema.org
 */
export function localBusiness({
  name,
  url,
  type = 'LocalBusiness',
  id,
  address,
  telephone,
  email,
  image,
  priceRange,
  geo,
  hours,
  sameAs,
  ...rest
}) {
  required('localBusiness', { name, url })
  return compact({
    '@type': type,
    '@id': id ?? nodeId(url, 'localbusiness'),
    name,
    url: absolute('localBusiness', 'url', url),
    image: image && absolute('localBusiness', 'image', image),
    telephone,
    email,
    priceRange,
    address: postalAddress(address),
    geo: geo && { '@type': 'GeoCoordinates', latitude: geo.latitude, longitude: geo.longitude },
    openingHoursSpecification: nonEmpty(
      hours?.map(({ days, opens, closes }) => ({
        '@type': 'OpeningHoursSpecification',
        dayOfWeek: days,
        opens,
        closes
      }))
    ),
    sameAs: nonEmpty(sameAs),
    ...rest
  })
}

/**
 * Breadcrumbs with absolute, no-trailing-slash item URLs and 1-based positions.
 *
 * @param {{ site: string | URL, items: Array<{ name: string, path: string }> }} options `path` is a
 *   path on the site or an absolute URL
 */
export function breadcrumbList({ site, items }) {
  if (!Array.isArray(items) || items.length === 0) throw new TypeError('breadcrumbList needs at least one item')
  return {
    '@type': 'BreadcrumbList',
    itemListElement: items.map(({ name, path }, index) => {
      required('breadcrumbList item', { name, path })
      return { '@type': 'ListItem', position: index + 1, name, item: canonicalUrl(path, site) }
    })
  }
}

/**
 * FAQPage. Google shows no FAQ rich result for any site since 2026-05-07; the markup is kept
 * because it still helps AI answers and entity resolution (seo-schema).
 *
 * @param {{ items: Array<{ question: string, answer: string }> }} options
 */
export function faqPage({ items }) {
  if (!Array.isArray(items) || items.length === 0) throw new TypeError('faqPage needs at least one item')
  return {
    '@type': 'FAQPage',
    mainEntity: items.map(({ question, answer }) => {
      required('faqPage item', { question, answer })
      return { '@type': 'Question', name: question, acceptedAnswer: { '@type': 'Answer', text: answer } }
    })
  }
}

/**
 * @param {{
 *   name: string, startDate: string | Date, endDate?: string | Date, url?: string,
 *   description?: string, image?: string | string[],
 *   location?: { name?: string, address?: object } | object,
 *   organizer?: string | object, eventStatus?: string, attendanceMode?: string, offers?: object
 * } & Record<string, unknown>} options `eventStatus` and `attendanceMode` take the short name
 *   (`EventScheduled`, `OfflineEventAttendanceMode`) or the full schema.org URL
 */
export function event({
  name,
  startDate,
  endDate,
  url,
  description,
  image,
  location,
  organizer,
  eventStatus,
  attendanceMode,
  offers,
  ...rest
}) {
  required('event', { name, startDate })
  return compact({
    '@type': 'Event',
    name,
    startDate: isoDate(startDate),
    endDate: endDate && isoDate(endDate),
    url: url && absolute('event', 'url', url),
    description,
    image: Array.isArray(image)
      ? image.map((src) => absolute('event', 'image', src))
      : image && absolute('event', 'image', image),
    location:
      location &&
      (location['@type']
        ? location
        : compact({ '@type': 'Place', name: location.name, address: postalAddress(location.address) })),
    organizer: typeof organizer === 'string' ? { '@type': 'Organization', name: organizer } : organizer,
    eventStatus: eventStatus && schemaEnum(eventStatus),
    eventAttendanceMode: attendanceMode && schemaEnum(attendanceMode),
    offers,
    ...rest
  })
}

/**
 * @param {{ name: string, url: string, id?: string, publisher?: string | object } & Record<string, unknown>} options
 *   `publisher` as a string is an `@id` reference (`https://example.com/#organization`)
 */
export function website({ name, url, id, publisher, ...rest }) {
  required('website', { name, url })
  return compact({
    '@type': 'WebSite',
    '@id': id ?? nodeId(url, 'website'),
    name,
    url: absolute('website', 'url', url),
    publisher: typeof publisher === 'string' ? { '@id': publisher } : publisher,
    ...rest
  })
}

function required(builder, fields) {
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null || value === '') throw new TypeError(`${builder} needs ${key}`)
  }
}

function absolute(builder, field, value) {
  if (!/^https?:\/\//i.test(String(value))) {
    throw new TypeError(`${builder}: ${field} must be an absolute URL (got ${JSON.stringify(value)})`)
  }
  return String(value)
}

function nodeId(url, name) {
  return `${new URL(absolute(name, 'url', url)).origin}/#${name}`
}

function isoDate(value) {
  return value instanceof Date ? value.toISOString() : value
}

function schemaEnum(value) {
  return /^https?:\/\//.test(value) ? value : `https://schema.org/${value}`
}

function nonEmpty(list) {
  return Array.isArray(list) && list.length ? list : undefined
}

function compact(node) {
  return Object.fromEntries(
    Object.entries(node).filter(([, value]) => value !== undefined && value !== null && value !== '')
  )
}
