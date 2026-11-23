/**
 * The billing period of a Stripe subscription, as Dates.
 *
 * Since API version 2025-03-31.basil the period lives on each subscription item
 * (`items.data[n].current_period_start/end`) and the subscription no longer has `current_period_start/end`
 * at all. A client on the pin gets the new shape, but a webhook payload is rendered in its endpoint's own
 * API version, so an older endpoint can still send the old top-level fields; those are the fallback when no
 * item carries a period.
 *
 * Items can bill on different cycles. The item with the latest end wins, and the start is that same item's,
 * so the pair always describes one real period.
 *
 * Either value is null when Stripe's object doesn't say. A caller updating a stored row keeps the stored
 * value then, and never writes the null over it.
 * @param {object | null | undefined} subscription a Stripe Subscription, in either shape
 * @returns {{ start: Date | null, end: Date | null }}
 */
export function subscriptionPeriod(subscription) {
  const items = subscription?.items?.data ?? []

  let latest = null
  for (const item of items) {
    if (!Number.isFinite(item?.current_period_end)) continue
    if (!latest || item.current_period_end > latest.current_period_end) latest = item
  }

  if (latest) {
    return {
      start: toDate(latest.current_period_start ?? subscription.current_period_start),
      end: toDate(latest.current_period_end),
    }
  }

  return {
    start: toDate(subscription?.current_period_start),
    end: toDate(subscription?.current_period_end),
  }
}

function toDate(seconds) {
  return Number.isFinite(seconds) ? new Date(seconds * 1000) : null
}
