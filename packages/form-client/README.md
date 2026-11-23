# @coderizehq/form-client

**It talks to `form-api-ses`, the old fleet's form handler.** CoderizeHQ's own form endpoint (platform
`aws/live/forms`, `POST /v1/<site>`) takes no `client` key and no uploads, so this package does not work against it
as it stands.

The browser half of the shared form handler, `form-api-ses`: one call that sends a form, the spam guard it
expects, the reserved-key filter, and file uploads through presigned S3 posts. The core has no framework, so an
Astro `<script>` and a React island use the same code; a small React hook lives under `@coderizehq/form-client/react`.

```bash
pnpm add @coderizehq/form-client
```

Optional peer dependency: `react` 18 or 19, only for the `/react` entry. Plain JavaScript (ESM) with TypeScript
types included. Visual states (sending, sent, the error box, a phone number to call) stay in each site.

## What it replaces

Before this package the fleet had eight versions of the same few lines, and they disagreed:

- **An unset endpoint sent nothing and nobody knew.** Sites that read `PUBLIC_FORM_API_URL` called
  `fetch(undefined)` when the build lacked it. `submitForm` throws `FormClientConfigError` instead.
- **The API's own message was thrown away.** It answers every refusal with a sentence for the visitor ("Too many
  submissions. Please try again later or call us."), and several forms replaced it with "Something went wrong".
  `submitForm` hands that sentence back.
- **A field could overwrite a setting.** A field named `form`, `client` or `subject` changed where or how the lead
  was sent, and one named `consent` vanished from the email. Only one copy filtered them.
- **The spam guard was copied by hand,** byte for byte in some repos and cut down in others.

## The endpoint

The package does not know the endpoint and does not read the environment. Each site passes its own
`PUBLIC_FORM_API_URL`, which the deploy workflow puts in the build from the repo variable of the same name:

```yaml
- uses: CoderizeDEV/actions/deploy-static-site@v1
  with:
    build-env: |
      PUBLIC_FORM_API_URL=${{ vars.PUBLIC_FORM_API_URL }}
```

`ci.yml` needs the same line, or CI builds a site whose forms throw. An empty or missing value is a setup mistake,
so `submitForm` and `uploadFile` throw `FormClientConfigError` (with the variable's name in the message) instead
of resolving as if the form had gone. Catch it only to show the visitor a fallback; never treat it as sent.

## `submitForm`

```js
import { createFormGuard, submitForm } from '@coderizehq/form-client'

const result = await submitForm({
  endpoint: import.meta.env.PUBLIC_FORM_API_URL,
  client: 'clientkey', // the site's key in form-api-ses clients.json
  form: 'contact', // optional: picks forms.contact's subject and recipient
  fields: new FormData(formEl), // or a plain object
  guard, // from createFormGuard() or useFormGuard()
})
```

| Option     | What it is                                                                                         |
| ---------- | -------------------------------------------------------------------------------------------------- |
| `endpoint` | The site's `PUBLIC_FORM_API_URL`. Required.                                                        |
| `client`   | The site's key in `clients.json`. Required.                                                        |
| `form`     | The form's name in the client's `forms`, for its own subject and recipient.                        |
| `subject`  | Replaces the email's subject for this one submission (it beats `forms.<form>.subject`).            |
| `fields`   | A `FormData` or a plain object. Repeated FormData names become a list; files are uploaded first.   |
| `guard`    | The spam guard. Without it no `_fillMs` is sent, so the client's autoresponder never goes out.     |
| `files`    | Files to upload before sending (`input.files` works). Only for a client with `uploads` set.        |
| `uploads`  | Keys of files already sent with `uploadFile`, for a form that uploads as soon as a file is picked. |
| `signal`   | An `AbortSignal`. Aborting rejects with the abort reason; it is never reported as a failure.       |

It resolves one of two shapes and never throws for an answer from the API:

- `{ ok: true }`: the API accepted the form. That includes the silent success it gives a spam trap, so there is
  nothing for a bot to learn from the page.
- `{ ok: false, status, message }`: `message` is the API's own sentence, ready to show. `status: 0` means nothing
  answered: the visitor is offline, or the browser refused the response for CORS (see Troubleshooting).

| Status | From form-api-ses                                                                                             |
| ------ | ------------------------------------------------------------------------------------------------------------- |
| 400    | Unknown client, an empty form, a bad request body, or an attached file it can't accept.                       |
| 403    | The page's origin isn't in the client's `origins`. "This form only accepts submissions from its own website." |
| 413    | A file over the client's `uploads.maxBytes`.                                                                  |
| 415    | A file type the client doesn't list. The message names the allowed types.                                     |
| 429    | Too many submissions or uploads from one source in an hour.                                                   |
| 500    | The email could not be sent. "Failed to send email."                                                          |
| 502    | An attached file could not be checked.                                                                        |
| 503    | Uploads are switched off in the API, or API Gateway itself is unavailable.                                    |

form-api-ses has no per-field errors, so there is no `fieldErrors`. Validate fields in the form before sending.

## The spam guard

form-api-ses checks two traps and answers both with a 200 `{ ok: true }` that sends nothing:

- **`website`**, a honeypot: an input people never see. A bot that fills it in is dropped.
- **`_fillMs`**, how long the form was on screen. Under 3000 ms is dropped. The API also refuses the client's
  autoresponder without one, so every form sends it.

The guard measures and reports; the API decides. A filled trap is still posted, which is what makes the
honeypot test under Troubleshooting work.

### Astro and plain scripts: `createFormGuard`

```js
const guard = createFormGuard({ form: formEl })
```

The clock starts when it is created. For a form that appears later (a modal, a second step), call `guard.start()`
when it is shown. With `form`, the honeypot is read from the form's own `website` input at submit time.

### React: `useFormGuard`

```jsx
import { useFormGuard } from '@coderizehq/form-client/react'

const { trapProps, guard } = useFormGuard()
// <input {...trapProps} />
```

The clock starts after mount, so a prerender never counts as time on screen. `trapProps` is a controlled
`type="text"` input named `website` with `tabIndex={-1}`, `autoComplete="off"`, `aria-hidden` and the Tailwind
class `hidden`; spread it first and put your own `className` after it on a site without Tailwind. `guardFields`
is still returned, so a form that builds its own body can keep `{ ...guardFields(), ...fields }` while it moves.

## Reserved keys

`RESERVED_FIELDS` lists the keys form-api-ses reads as settings: `client`, `form`, `subject`, `redirect`,
`website`, `consent`, `_fillMs` and `uploads`. A field with one of these names is sent as `<name>_field`
(`consent` arrives in the email as "Consent Field") with a console warning, so it can't change the recipient,
subject or traps, and its value isn't lost. Rename the field in the form to silence the warning.

`website` is the one special case, because it is the honeypot's name:

- **With a guard**, the honeypot comes only from the guard. A `website` field equal to the guard's value is the
  trap's own input read a second time (a `FormData` of the whole form) and is dropped. A different value is a real
  field and is sent as `website_field`.
- **Without a guard**, a `website` field is taken as the honeypot, as the sites wired it before this package.

Name a real "your website" input something else (`company_website`). An input named `website` is the trap.

## File uploads

For a client with `uploads` in `clients.json`, give `submitForm` the files. It uploads each one, then submits the
form with their keys:

```js
await submitForm({ endpoint, client: 'clientkey', fields: new FormData(formEl), guard })
```

Any non-empty file input in that FormData is uploaded; an empty one is skipped. Or pass `files: input.files`.
An upload the API refuses (415 type, 413 size) stops the submission and resolves its message.

To upload as soon as a file is picked, with progress, use `uploadFile` and send the key later:

```js
import { uploadFile } from '@coderizehq/form-client'

const upload = await uploadFile({ endpoint, client: 'clientkey', file, signal, onProgress: (f) => setProgress(f) })
if (upload.ok) uploads.push(upload.key)
// later: submitForm({ ..., uploads })
```

How it works: `POST /upload` on the API with `{ client, filename, size }` returns a presigned POST for one file,
good for 10 minutes. The file goes from the browser straight to the uploads bucket as `multipart/form-data`, with
the presigned fields first and the file last. The form then carries `uploads: [key, …]`, at most 5, and the
owner's email links each file for 30 days. `onProgress` uses `XMLHttpRequest`, because fetch can't report upload
progress; without it, plain fetch is used.

**Enabling uploads for a client takes two repos:** `uploads` in form-api-ses `clients.json`, and the site's origins
in the bucket's CORS rule (`allowedOrigins` in `coderize-infra` `bin/app.js`). Without the second, the upload
resolves `status: 0`.

## Moving a site over

Each move needs one real check on the live site (see Troubleshooting); the clients' `origins` lists are not all
complete.

### An Astro form

Before, a hand-rolled script:

```astro
<form id="quote-form">
  <input name="name" required />
  <input name="email" type="email" required />
  <textarea name="message"></textarea>
  <input name="website" type="text" class="hidden" tabindex="-1" autocomplete="off" aria-hidden="true" />
  <button type="submit">Send</button>
  <p id="quote-form-status" role="status"></p>
</form>

<script>
  const FORM_API = 'https://…'
  const shownAt = performance.now()
  // …fetch, res.ok, a generic error…
</script>
```

After, with the same markup:

```astro
<script>
  import { createFormGuard, submitForm } from '@coderizehq/form-client'

  const form = document.getElementById('quote-form') as HTMLFormElement
  const status = document.getElementById('quote-form-status') as HTMLElement
  const button = form.querySelector('button[type="submit"]') as HTMLButtonElement
  const guard = createFormGuard({ form })

  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    button.disabled = true
    status.textContent = 'Sending…'
    try {
      const result = await submitForm({
        endpoint: import.meta.env.PUBLIC_FORM_API_URL,
        client: 'clientkey',
        form: 'quote',
        fields: new FormData(form),
        guard,
      })
      if (result.ok) {
        form.reset()
        status.textContent = 'Thanks, we got your message.'
      } else {
        status.textContent = result.message
      }
    } catch (err) {
      // FormClientConfigError: the build has no PUBLIC_FORM_API_URL. Say so; never show "sent".
      console.error(err)
      status.textContent = 'This form is not working right now. Please call us.'
    } finally {
      button.disabled = false
    }
  })
</script>
```

Delete the site's hard-coded endpoint, its `shownAt` timer and its own `fetch`. Add `PUBLIC_FORM_API_URL` to
`build-env` in `ci.yml` and `deploy.yml` if the site hard-coded the URL before.

### A React form

Before, with a copied `useFormGuard.js`:

```jsx
const guard = useFormGuard()
// …
const res = await fetch(import.meta.env.PUBLIC_FORM_API_URL, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ client: 'clientkey', form: 'contact', ...form, ...guard.guardFields() }),
})
if (!res.ok) throw new Error('Failed to submit')
```

After:

```jsx
import { submitForm } from '@coderizehq/form-client'
import { useFormGuard } from '@coderizehq/form-client/react'
import { useState } from 'react'

export function ContactForm() {
  const { trapProps, guard } = useFormGuard()
  const [state, setState] = useState({ status: 'idle', message: '' })

  async function handleSubmit(event) {
    event.preventDefault()
    setState({ status: 'sending', message: '' })
    try {
      const result = await submitForm({
        endpoint: import.meta.env.PUBLIC_FORM_API_URL,
        client: 'clientkey',
        form: 'contact',
        fields: new FormData(event.currentTarget),
        guard,
      })
      setState(result.ok ? { status: 'sent', message: '' } : { status: 'error', message: result.message })
    } catch (err) {
      console.error(err)
      setState({ status: 'error', message: 'This form is not working right now. Please call us.' })
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <input name="name" required />
      <input name="email" type="email" required />
      <textarea name="message" />
      <input {...trapProps} />
      <button disabled={state.status === 'sending'}>Send</button>
      {state.status === 'error' && <p role="alert">{state.message}</p>}
    </form>
  )
}
```

A form that keeps its fields in state passes that object as `fields` instead of a FormData. Delete the copied
`useFormGuard.js`, `useFillTime.js`, `lib/contact.js` or `lib/leadClient.js` once nothing imports it.

## Troubleshooting

- **Check a moved form without sending an email.** On the live page, type anything into the hidden `website`
  input (devtools: `document.querySelector('[name=website]').value = 'test'`) and submit. form-api-ses checks the
  origin before the traps, so `{ ok: true }` proves the origin is accepted and sends nothing. A 403 means the page's
  origin is missing from the client's `origins`.
- **`status: 0` on every submit.** The origin is in no client's `origins` at all, so the API's CORS answer
  doesn't name it and the browser hides the response from the page. Add every host the site serves from, preview
  hosts and `www` included, to `clients.json`. Uploads failing alone with `status: 0` is the bucket's CORS rule.
- **The lead arrives without a field.** Look for a reserved name in the console warnings.
- **No autoresponder.** The form sent no guard, or the visitor's `email` was not one valid address.

## What it doesn't do

- **`redirect`.** That is for a plain HTML form post with no script; with fetch the 302 would land on a page the
  script can't use, so a `redirect` field is renamed like any other reserved key.
- **Server-side sending.** A server invokes the Lambda directly, with no origin and no caps, and runs its own spam
  checks. Text-message alerts only go out that way.
- **Visual states, validation and conversion tracking.** They stay in the site.
