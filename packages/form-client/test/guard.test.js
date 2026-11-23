import { afterEach, describe, expect, it, vi } from 'vitest'

import { createFormGuard, HONEYPOT_FIELD } from '../index.js'

afterEach(() => {
  vi.restoreAllMocks()
})

// A stand-in for HTMLFormElement: only `elements.namedItem` is read.
const formWith = (controls) => ({ elements: { namedItem: (name) => controls[name] ?? null } })

describe('createFormGuard', () => {
  it('measures the time since it was created, in whole milliseconds', () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(100.2)
    const guard = createFormGuard()
    now.mockReturnValue(4321.9)
    expect(guard.fields()).toEqual({ website: '', _fillMs: 4222 })
  })

  it('restarts the clock on start(), for a form shown later', () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(0)
    const guard = createFormGuard()
    now.mockReturnValue(60_000)
    guard.start()
    now.mockReturnValue(61_500)
    expect(guard.fields()._fillMs).toBe(1500)
  })

  it("reads the honeypot from the form's website control at submit time", () => {
    const trap = { value: '' }
    const guard = createFormGuard({ form: formWith({ website: trap }) })
    expect(guard.fields().website).toBe('')
    trap.value = 'http://spam.example'
    expect(guard.fields().website).toBe('http://spam.example')
  })

  it('falls back to setTrap() when the form has no website control', () => {
    const guard = createFormGuard({ form: formWith({}) })
    guard.setTrap('filled')
    expect(guard.fields().website).toBe('filled')
  })

  it('names the honeypot as form-api-ses does', () => {
    expect(HONEYPOT_FIELD).toBe('website')
  })
})
