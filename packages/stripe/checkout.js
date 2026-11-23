/**
 * The ship-to name and address a Checkout Session collected, or null when it collected none.
 *
 * Since API version 2025-03-31.basil Stripe returns them at `collected_information.shipping_details`; the
 * old top-level `shipping_details` no longer comes back at the pin, so code reading only that one falls
 * through to the billing address on every shipped order. The old field is read second, for payloads from a
 * webhook endpoint still on an older version.
 *
 * An app whose own copy returned `{}` for no shipping writes `checkoutShipping(session) ?? {}` to keep that.
 * @param {object | null | undefined} session a Stripe Checkout Session, in either shape
 * @returns {{ name?: string | null, address?: object | null } | null}
 */
export function checkoutShipping(session) {
  return session?.collected_information?.shipping_details ?? session?.shipping_details ?? null
}
