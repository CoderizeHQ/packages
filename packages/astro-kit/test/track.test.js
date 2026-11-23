import { afterEach, describe, expect, it, vi } from 'vitest'

import { track } from '../track.js'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('track', () => {
  it('pushes the event and its parameters onto dataLayer, creating it if needed', () => {
    const window = {}
    vi.stubGlobal('window', window)
    track('click_phone', { link_location: 'header' })
    track('quote_submit')
    expect(window.dataLayer).toEqual([{ link_location: 'header', event: 'click_phone' }, { event: 'quote_submit' }])
  })

  it('keeps the event name even when a parameter is called event', () => {
    const window = { dataLayer: [] }
    vi.stubGlobal('window', window)
    track('form_submit', { event: 'other' })
    expect(window.dataLayer).toEqual([{ event: 'form_submit' }])
  })

  it('does nothing outside a browser', () => {
    expect(typeof window).toBe('undefined')
    expect(() => track('click_email')).not.toThrow()
  })

  it('needs an event name', () => {
    expect(() => track('')).toThrow(/event name/)
    expect(() => track()).toThrow(/event name/)
  })
})
