import { Capacitor } from '@capacitor/core'
import { Haptics, ImpactStyle } from '@capacitor/haptics'

// A short buzz on taps and big moments: the native haptics engine inside the store apps,
// the vibration API on the web where the device has one.
const native = Capacitor.isNativePlatform()
const STYLES = { light: ImpactStyle.Light, medium: ImpactStyle.Medium, heavy: ImpactStyle.Heavy }
const WEB_MS = { light: 8, medium: 16, heavy: 30 }

export function buzz(strength = 'light') {
  const navigator = globalThis.navigator
  if (native) {
    Haptics.impact({ style: STYLES[strength] }).catch(() => {})
  } else if (navigator?.vibrate) {
    navigator.vibrate(WEB_MS[strength])
  }
}
