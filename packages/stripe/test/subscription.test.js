// Ported from gronetworking-com-mono, apps/api/src/util/subscriptionPeriod.test.js (node:test to Vitest).
import { describe, expect, it } from 'vitest'

import { subscriptionPeriod } from '../index.js'

const START = 1790000000
const END = 1792600000
const at = (seconds) => new Date(seconds * 1000)

// The shape since basil, unchanged through the pin (2026-10-28.endive): the period is on the item, and the
// subscription has no current_period_* fields at all.
const currentSubscription = {
  id: 'sub_1',
  status: 'active',
  items: { data: [{ id: 'si_1', current_period_start: START, current_period_end: END }] },
}

// The pre-basil shape an older webhook endpoint still sends.
const legacySubscription = {
  id: 'sub_1',
  current_period_start: START,
  current_period_end: END,
  items: { data: [{ id: 'si_1' }] },
}

describe('subscriptionPeriod', () => {
  it('reads the period from the subscription item', () => {
    expect(subscriptionPeriod(currentSubscription)).toEqual({ start: at(START), end: at(END) })
  })

  it('falls back to the pre-basil top-level fields', () => {
    expect(subscriptionPeriod(legacySubscription)).toEqual({ start: at(START), end: at(END) })
  })

  it('prefers the item period over stale top-level fields', () => {
    const both = { ...currentSubscription, current_period_start: 1, current_period_end: 2 }
    expect(subscriptionPeriod(both)).toEqual({ start: at(START), end: at(END) })
  })

  it('takes the item with the latest end when items bill on different cycles', () => {
    const twoItems = {
      items: {
        data: [
          { current_period_start: START, current_period_end: END },
          { current_period_start: START + 100, current_period_end: END + 100 },
          { current_period_start: START - 100, current_period_end: END - 100 },
        ],
      },
    }
    expect(subscriptionPeriod(twoItems)).toEqual({ start: at(START + 100), end: at(END + 100) })
  })

  it('returns null for both when neither shape carries a period', () => {
    const none = { start: null, end: null }
    expect(subscriptionPeriod({ id: 'sub_1', items: { data: [{ id: 'si_1' }] } })).toEqual(none)
    expect(subscriptionPeriod({ id: 'sub_1' })).toEqual(none)
    expect(subscriptionPeriod(null)).toEqual(none)
    expect(subscriptionPeriod(undefined)).toEqual(none)
  })
})
