// checkoutShipping is ported from xceptionalheroes-org-mono, apps/api/src/lib/checkoutShipping.js.
// Credits stay in the tests: they are not published, and the package is public.
import { describe, expect, it } from 'vitest'

import { checkoutShipping } from '../index.js'

const shipTo = {
  name: 'Test Recipient',
  address: { line1: '1 Test St', line2: null, city: 'Testville', state: 'MI', postal_code: '00000', country: 'US' },
}
const billing = { name: 'Billing Name', address: { line1: '2 Other St', city: 'Elsewhere', country: 'US' } }

describe('checkoutShipping', () => {
  it('reads collected_information.shipping_details, the shape since basil', () => {
    const session = { id: 'cs_1', collected_information: { shipping_details: shipTo }, customer_details: billing }
    expect(checkoutShipping(session)).toEqual(shipTo)
  })

  it('still reads the pre-basil top-level shipping_details', () => {
    expect(checkoutShipping({ id: 'cs_1', shipping_details: shipTo })).toEqual(shipTo)
  })

  it('prefers the new location when both are present', () => {
    const session = { collected_information: { shipping_details: shipTo }, shipping_details: billing }
    expect(checkoutShipping(session)).toEqual(shipTo)
  })

  it('falls back to the old field when the new one is null', () => {
    const session = { collected_information: { shipping_details: null }, shipping_details: shipTo }
    expect(checkoutShipping(session)).toEqual(shipTo)
  })

  it('returns null when the session collected no shipping, never the billing address', () => {
    expect(checkoutShipping({ collected_information: null, customer_details: billing })).toBeNull()
    expect(checkoutShipping({ collected_information: { shipping_details: null }, shipping_details: null })).toBeNull()
    expect(checkoutShipping(undefined)).toBeNull()
  })
})
