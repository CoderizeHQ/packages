import { describe, expect, it } from 'vitest'

import {
  breadcrumbList,
  event,
  faqPage,
  localBusiness,
  organization,
  postalAddress,
  serializeJsonLd,
  website,
} from '../schema.js'

const SITE = 'https://example.com'

describe('serializeJsonLd', () => {
  it('adds @context to a single node', () => {
    expect(JSON.parse(serializeJsonLd({ '@type': 'WebSite', name: 'A' }))).toEqual({
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: 'A',
    })
  })

  it('keeps a node that already has @context as it is', () => {
    const node = { '@context': 'https://schema.org/', '@type': 'Thing' }
    expect(JSON.parse(serializeJsonLd(node))).toEqual(node)
  })

  it('puts an array of nodes in one @graph, dropping their own @context', () => {
    expect(JSON.parse(serializeJsonLd([{ '@context': 'https://schema.org', '@type': 'A' }, { '@type': 'B' }]))).toEqual(
      {
        '@context': 'https://schema.org',
        '@graph': [{ '@type': 'A' }, { '@type': 'B' }],
      },
    )
  })

  it('escapes every < so a value cannot close the script tag', () => {
    const json = serializeJsonLd({ name: '</script><!-- <b>' })
    expect(json).not.toContain('<')
    expect(json).toContain('\\u003c/script>')
    expect(JSON.parse(json).name).toBe('</script><!-- <b>')
  })

  it('refuses something that is not an object', () => {
    expect(() => serializeJsonLd('x')).toThrow()
    expect(() => serializeJsonLd(null)).toThrow()
  })
})

describe('organization', () => {
  it('builds the node with a stable @id and leaves out empty fields', () => {
    expect(organization({ name: 'Acme', url: `${SITE}/`, logo: `${SITE}/logo.png`, sameAs: [] })).toEqual({
      '@type': 'Organization',
      '@id': 'https://example.com/#organization',
      name: 'Acme',
      url: 'https://example.com/',
      logo: 'https://example.com/logo.png',
    })
  })

  it('passes other Schema.org properties through', () => {
    expect(organization({ name: 'Acme', url: SITE, email: 'hi@example.com' }).email).toBe('hi@example.com')
  })

  it('needs a name and an absolute url', () => {
    expect(() => organization({ url: SITE })).toThrow(/needs name/)
    expect(() => organization({ name: 'Acme', url: '/' })).toThrow(/absolute URL/)
    expect(() => organization({ name: 'Acme', url: SITE, logo: '/logo.png' })).toThrow(/logo must be an absolute URL/)
  })
})

describe('localBusiness', () => {
  it('builds a subtype with address, geo and opening hours', () => {
    expect(
      localBusiness({
        type: 'InsuranceAgency',
        name: 'Acme Insurance',
        url: SITE,
        telephone: '+1-810-555-0100',
        address: { street: '1 Main St', city: 'Lapeer', region: 'MI', postalCode: '48446' },
        geo: { latitude: 43.05, longitude: -83.31 },
        hours: [{ days: ['Monday', 'Tuesday'], opens: '09:00', closes: '17:00' }],
      }),
    ).toEqual({
      '@type': 'InsuranceAgency',
      '@id': 'https://example.com/#localbusiness',
      name: 'Acme Insurance',
      url: 'https://example.com',
      telephone: '+1-810-555-0100',
      address: {
        '@type': 'PostalAddress',
        streetAddress: '1 Main St',
        addressLocality: 'Lapeer',
        addressRegion: 'MI',
        postalCode: '48446',
        addressCountry: 'US',
      },
      geo: { '@type': 'GeoCoordinates', latitude: 43.05, longitude: -83.31 },
      openingHoursSpecification: [
        { '@type': 'OpeningHoursSpecification', dayOfWeek: ['Monday', 'Tuesday'], opens: '09:00', closes: '17:00' },
      ],
    })
  })

  it('defaults to LocalBusiness', () => {
    expect(localBusiness({ name: 'Acme', url: SITE })['@type']).toBe('LocalBusiness')
  })
})

describe('postalAddress', () => {
  it('passes a PostalAddress through and leaves missing parts out', () => {
    const typed = { '@type': 'PostalAddress', addressLocality: 'Flint' }
    expect(postalAddress(typed)).toBe(typed)
    expect(postalAddress({ city: 'Flint', region: 'MI' })).toEqual({
      '@type': 'PostalAddress',
      addressLocality: 'Flint',
      addressRegion: 'MI',
      addressCountry: 'US',
    })
  })
})

describe('breadcrumbList', () => {
  it('numbers the items from 1 with absolute, no-slash URLs', () => {
    expect(
      breadcrumbList({
        site: SITE,
        items: [
          { name: 'Home', path: '/' },
          { name: 'Services', path: '/services/' },
          { name: 'Roofing', path: 'https://example.com/services/roofing/' },
        ],
      }),
    ).toEqual({
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://example.com/' },
        { '@type': 'ListItem', position: 2, name: 'Services', item: 'https://example.com/services' },
        { '@type': 'ListItem', position: 3, name: 'Roofing', item: 'https://example.com/services/roofing' },
      ],
    })
  })

  it('needs items with a name and a path', () => {
    expect(() => breadcrumbList({ site: SITE, items: [] })).toThrow(/at least one/)
    expect(() => breadcrumbList({ site: SITE, items: [{ name: 'Home' }] })).toThrow(/needs path/)
  })
})

describe('faqPage', () => {
  it('builds Question and Answer pairs', () => {
    expect(faqPage({ items: [{ question: 'Open Sundays?', answer: 'No.' }] })).toEqual({
      '@type': 'FAQPage',
      mainEntity: [{ '@type': 'Question', name: 'Open Sundays?', acceptedAnswer: { '@type': 'Answer', text: 'No.' } }],
    })
  })

  it('needs at least one complete item', () => {
    expect(() => faqPage({ items: [] })).toThrow(/at least one/)
    expect(() => faqPage({ items: [{ question: 'Q' }] })).toThrow(/needs answer/)
  })
})

describe('event', () => {
  it('builds an Event with a Place, enum URLs and ISO dates', () => {
    expect(
      event({
        name: 'Haunt Night',
        startDate: new Date('2026-10-22T23:00:00Z'),
        endDate: '2026-10-23T03:00:00-04:00',
        url: `${SITE}/events/haunt`,
        image: [`${SITE}/haunt.jpg`],
        location: { name: 'Fairgrounds', address: { city: 'Memphis', region: 'MI' } },
        organizer: 'Memphis Nightmare',
        eventStatus: 'EventScheduled',
        attendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
        offers: { '@type': 'Offer', price: '15', priceCurrency: 'USD' },
      }),
    ).toEqual({
      '@type': 'Event',
      name: 'Haunt Night',
      startDate: '2026-10-22T23:00:00.000Z',
      endDate: '2026-10-23T03:00:00-04:00',
      url: 'https://example.com/events/haunt',
      image: ['https://example.com/haunt.jpg'],
      location: {
        '@type': 'Place',
        name: 'Fairgrounds',
        address: { '@type': 'PostalAddress', addressLocality: 'Memphis', addressRegion: 'MI', addressCountry: 'US' },
      },
      organizer: { '@type': 'Organization', name: 'Memphis Nightmare' },
      eventStatus: 'https://schema.org/EventScheduled',
      eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
      offers: { '@type': 'Offer', price: '15', priceCurrency: 'USD' },
    })
  })

  it('passes a typed location through and needs a start date', () => {
    const location = { '@type': 'VirtualLocation', url: `${SITE}/live` }
    expect(event({ name: 'Live', startDate: '2026-11-01', location }).location).toBe(location)
    expect(() => event({ name: 'Live' })).toThrow(/needs startDate/)
  })
})

describe('website', () => {
  it('builds the node and turns a string publisher into an @id reference', () => {
    expect(website({ name: 'Acme', url: SITE, publisher: `${SITE}/#organization` })).toEqual({
      '@type': 'WebSite',
      '@id': 'https://example.com/#website',
      name: 'Acme',
      url: 'https://example.com',
      publisher: { '@id': 'https://example.com/#organization' },
    })
  })
})
