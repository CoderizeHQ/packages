import type { FormGuard, GuardFields } from './index.js'

/** Props for the hidden honeypot `<input>`. Spread them first, so the site can override `className`. */
export interface TrapProps {
  type: 'text'
  name: 'website'
  value: string
  onChange(event: { target: { value: string } }): void
  tabIndex: -1
  autoComplete: 'off'
  'aria-hidden': true
  className: string
}

export interface UseFormGuardResult {
  trapProps: TrapProps
  /** Pass to `submitForm`. */
  guard: FormGuard
  /** `guard.fields`, for a form that still builds its own request body. */
  guardFields(): GuardFields
}

/** The spam guard for a React form. The fill-time clock starts after mount. */
export declare function useFormGuard(): UseFormGuardResult
