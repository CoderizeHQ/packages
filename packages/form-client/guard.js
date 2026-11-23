// The two spam traps form-api-ses checks: a honeypot field named `website` that people never see but bots fill
// in, and `_fillMs`, how long the form was on screen before it was sent. A filled honeypot, or a `_fillMs` under
// 3000, gets the same 200 `{ ok: true }` as a real lead and sends nothing, so a bot sees success and moves on.
// The API decides; this only reports. A site with an autoresponder must send `_fillMs`: without it the lead still
// goes, but the reply is skipped.

/** The honeypot's field name, fixed by form-api-ses. */
export const HONEYPOT_FIELD = 'website'

/**
 * Starts the fill-time clock now. Call `start()` again when the form is shown later (a modal, a step that opens
 * on a click), so the time counts from when a person could first see it.
 *
 * The honeypot is read from `form`'s own `website` control when one is given (an Astro form), or from the last
 * `setTrap()` (a controlled input).
 *
 * @param {{ form?: { elements: { namedItem(name: string): unknown } } | null }} [options]
 */
export function createFormGuard({ form } = {}) {
  let shownAt = performance.now()
  let trap = ''

  return {
    start() {
      shownAt = performance.now()
    },
    setTrap(value) {
      trap = value == null ? '' : String(value)
    },
    fields() {
      const input = form?.elements?.namedItem(HONEYPOT_FIELD)
      const website = input && typeof input === 'object' && 'value' in input ? String(input.value ?? '') : trap
      return { website, _fillMs: Math.max(0, Math.round(performance.now() - shownAt)) }
    }
  }
}
