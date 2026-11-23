#!/usr/bin/env node
// coderize-stripe-check: the version guard, for an app's CI. Exits 1 when a check fails.
import { checkStripeVersion } from './guard.js'

const result = checkStripeVersion()

for (const check of result.checks) {
  const status = check.ok ? 'PASS' : 'FAIL'
  console.log(`  ${status}  ${check.label}${check.ok ? '' : ` - ${JSON.stringify(check.detail)}`}`)
}

const failed = result.checks.filter((c) => !c.ok).length
console.log(`\ncoderize-stripe-check: ${result.checks.length - failed} passed, ${failed} failed`)

if (!result.ok) process.exitCode = 1

if (result.checks.some((c) => c.id === 'sdk-default' && !c.ok)) {
  console.log(
    `\nThe installed stripe ${result.sdkVersion ?? '(unknown)'} defaults to API version ${result.sdkDefault ?? '(unknown)'}.\n` +
      'This release of @coderizehq/stripe has not reviewed it. Do not pin around it in the app: update\n' +
      '@coderizehq/stripe to a release that lists it, or hold stripe at the version it had until one exists.',
  )
}
