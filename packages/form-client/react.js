import { useEffect, useState } from 'react'

import { createFormGuard, HONEYPOT_FIELD } from './guard.js'

/**
 * The spam guard for a React form. Spread `trapProps` onto an `<input>` people never see, and pass `guard` to
 * `submitForm`. The fill-time clock starts after mount, so a prerender never counts as time on screen.
 *
 * `guardFields` is `guard.fields`, for a form that still builds its own request body.
 */
export function useFormGuard() {
  const [guard] = useState(() => createFormGuard())
  const [website, setWebsite] = useState('')

  useEffect(() => {
    guard.start()
  }, [guard])

  return {
    trapProps: {
      type: 'text',
      name: HONEYPOT_FIELD,
      value: website,
      onChange: (event) => {
        setWebsite(event.target.value)
        guard.setTrap(event.target.value)
      },
      tabIndex: -1,
      autoComplete: 'off',
      'aria-hidden': true,
      className: 'hidden',
    },
    guard,
    guardFields: guard.fields,
  }
}
