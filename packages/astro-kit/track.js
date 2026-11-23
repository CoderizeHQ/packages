// Custom events go to Google Tag Manager as `dataLayer.push({ event, ...params })`, read in the
// site's container by a Custom Event trigger and Data Layer Variables (the setup on
// GTM-MH7Z5H9C for sweeteninsurance.com). Not `gtag('event', …)`: that needs a gtag shim, and
// GTM only turns those calls into GA4 events when a Google tag is configured to read them, so
// they vanish without an error when it isn't.

/**
 * Sends a custom event to GTM. Does nothing outside a browser. Safe to call before GTM has
 * loaded: GTM reads what is already on `dataLayer` when it starts.
 *
 * @param {string} event the event name the container's trigger matches (`click_phone`)
 * @param {Record<string, unknown>} [params] Data Layer Variables for the tags (`{ link_location: 'header' }`)
 */
export function track(event, params = {}) {
  if (typeof event !== 'string' || event === '') throw new TypeError('track needs an event name')
  if (typeof window === 'undefined') return
  window.dataLayer = window.dataLayer || []
  window.dataLayer.push({ ...params, event })
}
