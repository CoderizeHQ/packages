// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useFormGuard } from '../react.js'

let latest

// The trap the way a site renders it, without JSX so the repo's lint covers this file.
function Form() {
  const { trapProps, guard } = useFormGuard()
  latest = guard
  return createElement('form', null, createElement('input', { ...trapProps, 'data-testid': 'trap' }))
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('useFormGuard', () => {
  it('renders a hidden, unfocusable trap named website', () => {
    render(createElement(Form))
    const trap = screen.getByTestId('trap')
    expect(trap.getAttribute('name')).toBe('website')
    expect(trap.getAttribute('tabindex')).toBe('-1')
    expect(trap.getAttribute('aria-hidden')).toBe('true')
    expect(trap.getAttribute('autocomplete')).toBe('off')
    expect(trap.className).toBe('hidden')
  })

  it('reports what a bot typed into the trap', async () => {
    const user = userEvent.setup()
    render(createElement(Form))
    expect(latest.fields().website).toBe('')

    await user.type(screen.getByTestId('trap'), 'http://spam.example')
    expect(latest.fields().website).toBe('http://spam.example')
  })

  it('counts the fill time from when the form mounted', () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(1000)
    render(createElement(Form))
    now.mockReturnValue(4000)
    expect(latest.fields()._fillMs).toBe(3000)
  })
})
