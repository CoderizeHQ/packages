// Type-checked by `tsc -p test/types` in `pnpm test`, as an Astro <script> (TypeScript, DOM types) and a TSX
// island would import the package. Nothing here runs.
import {
  createFormGuard,
  FormClientConfigError,
  HONEYPOT_FIELD,
  RESERVED_FIELDS,
  submitForm,
  uploadFile
} from '@coderize/form-client'
import { useFormGuard } from '@coderize/form-client/react'

declare const env: { PUBLIC_FORM_API_URL?: string }

const form = document.querySelector('form') as HTMLFormElement
const guard = createFormGuard({ form })
guard.start()

const trapName: 'website' = HONEYPOT_FIELD
const reserved: readonly string[] = RESERVED_FIELDS

export async function astroSubmit(): Promise<string> {
  try {
    const result = await submitForm({
      endpoint: env.PUBLIC_FORM_API_URL,
      client: 'clientkey',
      form: 'contact',
      fields: new FormData(form),
      guard
    })
    if (result.ok) return 'sent'
    const status: number = result.status
    return `${status} ${result.message} ${trapName} ${reserved.length}`
  } catch (err) {
    if (err instanceof FormClientConfigError) return err.name
    throw err
  }
}

export async function withFiles(input: HTMLInputElement, signal: AbortSignal): Promise<boolean> {
  const uploaded = await uploadFile({
    endpoint: 'https://forms.example.test/',
    client: 'clientkey',
    file: input.files![0],
    signal,
    onProgress: (fraction) => console.log(fraction)
  })
  const keys = uploaded.ok ? [uploaded.key] : []
  const result = await submitForm({
    endpoint: null,
    client: 'clientkey',
    fields: { name: 'Jane', services: ['a', 'b'], consent: true },
    files: input.files ?? [],
    uploads: keys,
    subject: 'New quote request',
    signal
  })
  // @ts-expect-error message exists only on a failure
  return result.ok && result.message
}

// A React island: spread the trap onto an input, pass the guard on.
export function useIsland() {
  const { trapProps, guard: islandGuard, guardFields } = useFormGuard()
  trapProps.onChange({ target: { value: '' } })
  const name: 'website' = trapProps.name
  const fillMs: number | undefined = guardFields()._fillMs
  return { name, fillMs, send: () => submitForm({ endpoint: '', client: 'clientkey', guard: islandGuard }) }
}
