// Type-checked by `tsc -p test/types` in `pnpm test` (checkJs, DOM types), as an Astro <script> or a React island
// would import the package. Nothing here runs.
import {
  createFormGuard,
  FormClientConfigError,
  HONEYPOT_FIELD,
  RESERVED_FIELDS,
  submitForm,
  uploadFile,
} from '@coderizehq/form-client'
import { useFormGuard } from '@coderizehq/form-client/react'

/** @type {{ PUBLIC_FORM_API_URL?: string }} */
const env = {}

/** @type {'website'} */
const trapName = HONEYPOT_FIELD
/** @type {readonly string[]} */
const reserved = RESERVED_FIELDS

/**
 * @param {Document} doc
 * @returns {Promise<string>}
 */
export async function astroSubmit(doc) {
  const form = /** @type {HTMLFormElement} */ (doc.querySelector('form'))
  const guard = createFormGuard({ form })
  guard.start()
  try {
    const result = await submitForm({
      endpoint: env.PUBLIC_FORM_API_URL,
      client: 'clientkey',
      form: 'contact',
      fields: new FormData(form),
      guard,
    })
    if (result.ok) return 'sent'
    /** @type {number} */
    const status = result.status
    return `${status} ${result.message} ${trapName} ${reserved.length}`
  } catch (err) {
    if (err instanceof FormClientConfigError) return err.name
    throw err
  }
}

/**
 * @param {HTMLInputElement} input
 * @param {AbortSignal} signal
 * @returns {Promise<boolean>}
 */
export async function withFiles(input, signal) {
  const files = /** @type {FileList} */ (input.files)
  const uploaded = await uploadFile({
    endpoint: 'https://forms.example.test/',
    client: 'clientkey',
    file: files[0],
    signal,
    onProgress: (fraction) => console.log(fraction),
  })
  const keys = uploaded.ok ? [uploaded.key] : []
  const result = await submitForm({
    endpoint: null,
    client: 'clientkey',
    fields: { name: 'Jane', services: ['a', 'b'], consent: true },
    files: input.files ?? [],
    uploads: keys,
    subject: 'New quote request',
    signal,
  })
  // @ts-expect-error message exists only on a failure
  return result.ok && result.message
}

// A React island: spread the trap onto an input, pass the guard on.
export function useIsland() {
  const { trapProps, guard: islandGuard, guardFields } = useFormGuard()
  trapProps.onChange({ target: { value: '' } })
  /** @type {'website'} */
  const name = trapProps.name
  /** @type {number | undefined} */
  const fillMs = guardFields()._fillMs
  return { name, fillMs, send: () => submitForm({ endpoint: '', client: 'clientkey', guard: islandGuard }) }
}
