# @coderize/email

How every CoderizeDEV app sends transactional email through Amazon SES: one switch that decides whether mail
really goes out, Simple content or a hand-built raw MIME message when there are attachments, errors that say
whether a retry could help, logs that never carry a body in production, an HTML escaper, and the SNS signature
check for the route that receives SES bounce and complaint notices.

```bash
pnpm add @coderize/email
```

Peer dependency: `@aws-sdk/client-sesv2` 3 (3.1127 or later, the oldest the fleet runs). Each app already has it,
so this package never brings a second copy of the SDK. Plain JavaScript (ESM) with TypeScript types included.
Templates stay in each app: this package sends what they build.

## What it fixes

Nine fleet APIs and three Apps each had their own SES sender. They disagreed in ways that cost mail:

| Problem in the fleet copies                                                              | Here                                                                        |
| ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| coderize-dev, GRO and icrotary sent real mail from any machine with AWS credentials      | SES only when `EMAIL_PROVIDER=ses`; anything else logs                      |
| refuge and TTB logged 800 characters of every body, at error level in production         | No body, and no address, in a production log line                           |
| icrotary wrapped `to` in a list again and lost 11 raffle notifications                   | `to` is one address or a flat list; a nested list is refused                |
| coderize-dev's raw MIME wrote the subject and body unencoded                             | Every header 7-bit (RFC 2047), every body part base64 in 76-character lines |
| SES `Simple.Attachments` PDFs opened blank (icrotary, July 2026)                         | Attachments always go as raw MIME                                           |
| Failures thrown, returned or swallowed, with `id` in some apps and `messageId` in others | `send()` throws a classified `SendError`; `trySend()` never throws          |
| 21 HTML escapers, two of them missing `"` or `'`                                         | `esc()`                                                                     |
| gronetworking and coderize-dev accepted SNS certificates from `sns.s3.amazonaws.com`     | `@coderize/email/sns` accepts exactly `sns.<topic region>.amazonaws.com`    |

## 1. The mailer

Build one per app, at startup, and reuse it. In a Fastify API it is a plugin:

```js
// src/plugins/email.js
import fp from 'fastify-plugin'
import { createMailer } from '@coderize/email'

export default fp(async function emailPlugin(app) {
  const mailer = createMailer({
    from: process.env.EMAIL_FROM ?? 'ThawWatch <alerts@thawwatch.com>',
    logger: app.log
  })
  if (mailer.mode === 'log' && process.env.NODE_ENV === 'production') {
    app.log.error('EMAIL_PROVIDER is not ses: no email will be sent')
  }
  app.decorate('mailer', mailer)
})
```

`createMailer(options)`:

| Option             | Default                        | What it is                                                                                |
| ------------------ | ------------------------------ | ----------------------------------------------------------------------------------------- |
| `from`             | none                           | The app's default From. A message's own `from` overrides it.                              |
| `configurationSet` | none                           | A configuration set named on every send. See [Configuration sets](#5-configuration-sets). |
| `logger`           | `console`                      | pino (`app.log`, `request.log`) or anything with `info` and `error`.                      |
| `client`           | an `SESv2Client`, built lazily | Inject a fake in tests. Credentials always come from the instance or task role.           |
| `region`           | `AWS_REGION`, then `us-east-1` | Where the SES identities live.                                                            |
| `env`              | `process.env`                  | Read once, when the mailer is created.                                                    |

### The switch: `EMAIL_PROVIDER=ses`

| Env                                       | What `send()` does                                                                                    |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `EMAIL_PROVIDER=ses`                      | Sends through SES.                                                                                    |
| anything else, in production (`NODE_ENV`) | Logs one **error** line (`EMAIL NOT SENT`), the subject and the recipient count. No address, no body. |
| anything else, elsewhere                  | Logs one **info** line with the recipients, the subject and the first 800 characters of the body.     |

That is the only switch. A laptop or CI runner with AWS credentials sends nothing unless someone sets
`EMAIL_PROVIDER=ses` on purpose, and production without it is loud on every send instead of looking like
success. Never set a "sent" flag on a logged result: refugelapeer's receipts were stamped sent for weeks while
its mailer only logged.

## 2. Sending

```js
const result = await app.mailer.send({
  to: user.email, // one address, or a flat list
  subject: 'Reset your password',
  text,
  html,
  replyTo: 'support@thawwatch.com' // optional, as are cc, bcc, from, headers, attachments
})
```

| Field                        | Notes                                                                                                           |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `to`, `cc`, `bcc`, `replyTo` | `a@b.com` or `Name <a@b.com>`, or a flat list of them. One address per string: `'a@b.com, c@d.com'` is refused. |
| `from`                       | Overrides the mailer's default.                                                                                 |
| `subject`                    | Required. A line break in it (from an interpolated name, say) becomes a space.                                  |
| `text`, `html`               | At least one. Send both: the text part is the fallback and helps with spam filters.                             |
| `headers`                    | `{ 'List-Unsubscribe': '<https://...>', 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' }`                |
| `attachments`                | `[{ filename, content, contentType? }]`; see [Attachments](#3-attachments).                                     |
| `configurationSet`           | Overrides the mailer's set for this message.                                                                    |

`send()` resolves one of three results:

| `status`  | `id`            | When                                                         |
| --------- | --------------- | ------------------------------------------------------------ |
| `sent`    | SES's MessageId | SES accepted the message.                                    |
| `logged`  | `null`          | `EMAIL_PROVIDER` is not `ses`: the message was not sent.     |
| `skipped` | `null`          | `to` is empty (or holds only empty entries). Nothing logged. |

It **throws a `SendError`** when the message did not go out: SES refused it, or this package refused to build it
(no subject, a bad address, a header it owns). The failure is already logged by then, so a caller doesn't log
it again.

`trySend()` takes the same message and **never throws**. It resolves `{ ok: true, status, id, error: null }`, or
`{ ok: false, status: 'failed', id: null, error }` with the `SendError`. Use it where a failed email must not
fail the request, such as a password reset that answers the same whether or not the address exists:

```js
app.post('/auth/forgot', async (request) => {
  // ...create the token...
  app.mailer.trySend({ to: user.email, ...passwordResetEmail({ url }) }) // not awaited: the answer never waits on SES
  return { ok: true }
})
```

Await `send()` where delivery matters to the caller (a receipt row stamped with the MessageId, a job that
retries); use `trySend()` or a `.catch()` everywhere else.

## 3. Attachments

```js
await app.mailer.send({
  to: organizer.email,
  replyTo: 'billing@takeurown.com',
  subject: `Invoice ${invoice.number}`,
  text,
  html,
  attachments: [
    { filename: `invoice-${invoice.number}.pdf`, content: pdfBuffer },
    { filename: 'ticket.png', content: qrPng, contentType: 'image/png' }
  ]
})
```

- `content` is a `Buffer` or `Uint8Array`, or a base64 string (what Resend took). Any other string is refused:
  a CSV passed as text would otherwise be decoded as base64 into garbage.
- `contentType` comes from the extension when left out (pdf, png, jpg, gif, webp, svg, csv, txt, ics, json,
  xml, zip, html), `application/octet-stream` otherwise.
- `filename` loses any path and control characters. Non-ASCII names work.

A message with any attachment goes to SES as **raw MIME** (`Content.Raw`), built here without nodemailer:
`multipart/mixed` around a `multipart/alternative` text and html pair, each attachment base64 in 76-character
lines, CRLF line ends, RFC 2047 encoded-words for a non-ASCII subject, display name or filename (plus the RFC
2231 `filename*` form). The tests decode a real PDF and a PNG back out of the message and compare them byte for
byte. Bcc is never written into the message: it goes in the SES envelope only, which keeps it blind.

Why not SES's own `Simple.Attachments`: PDFs sent that way opened blank in real mail clients (icrotary,
2026-07), and SES sends a binary as text unless each attachment sets `ContentTransferEncoding: 'BASE64'`. Raw is
the fleet rule until a Simple path is proved against real clients. `buildRawMessage(message, { from })` returns
the same bytes `send()` would hand SES, for an `.eml` download or a test.

## 4. Headers and one-click unsubscribe

Custom headers work on both paths: Simple content carries them as SES `Headers`, raw MIME writes them into the
message. A digest or any other mail a user can opt out of carries the RFC 8058 pair:

```js
headers: {
  'List-Unsubscribe': `<${unsubscribeUrl}>, <mailto:unsubscribe@dmarc.ws>`,
  'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
}
```

Refused: a name that isn't a valid header name, a value with a line break, and the headers this package writes
itself (From, To, Cc, Bcc, Reply-To, Subject, MIME-Version, Content-Type, Content-Transfer-Encoding,
Content-Disposition). Use the message fields for those.

## 5. Configuration sets

**The default is none: no `ConfigurationSetName` is sent.** SES still applies the identity's own default set
(`coderize-default` on most fleet identities), so events keep flowing exactly as they do today. Why not name
`coderize-default` by default:

- Where the identity's default already is `coderize-default`, naming it changes nothing.
- Where it isn't, naming it breaks mail. Any configuration set on a send, named or the identity default, makes
  SES check the sender's IAM policy against **the set's ARN as well as the identity's**, and a miss fails every
  send with `AccessDenied` while the app answers 200 (icrotary, takeurown and xceptionalheroes on 2026-09-17;
  the `coderize-seo-report` role for four days after). `notifications.gronetworking.com` defaults to the
  `gronetworking` set and `boulanmanor.com` to none: a package-wide name would move GRO's events and fail any
  sender whose policy doesn't list `coderize-default`.
- A set named in code also overrides the identity's default for good, so a later change to an identity's
  default set would silently not apply.

Pass `configurationSet` (on the mailer, or per message) only when the app wants a set other than its identity's
default, such as one of its own for event tracking. Before you do, add that set's ARN to the app's
`<app>-ses-send` policy on `coderize-apps-v3-instance`, and to every other principal that sends as the identity:

```json
"Resource": [
  "arn:aws:ses:us-east-1:651706755822:identity/<domain>",
  "arn:aws:ses:us-east-1:651706755822:configuration-set/<set>"
]
```

Never turn on open or click tracking on `coderize-default`: it is the fleet-wide default set, so it would add a
tracking pixel and rewrite the links in every app's mail. An app that wants tracking gets a set of its own.

## 6. Errors and retries

`SendError` has `kind`:

- `transient`: throttling, an SES 5xx, a retryable SDK error, or no answer from AWS at all (DNS, a reset, a
  timeout). Worth trying again later.
- `permanent`: everything else, including AccessDenied, an unverified identity, a suppressed address rejected
  as `MessageRejected`, and any message this package refused to build. Retrying the same message won't help.

`error.cause` is the AWS error. `error.message` is `Email not sent`, or `Email not sent: <why>` for a refused
message; it never quotes an address or any content. `isTransientAwsError(err)` is the classifier on its own, for
an SMS sender (SNS, End User Messaging) that fails the same ways.

## 7. Logs

The mailer logs through the logger you pass, and never the body or the whole error object:

| Event                  | Level | Fields                                                                                       |
| ---------------------- | ----- | -------------------------------------------------------------------------------------------- |
| sent                   | info  | `messageId`, `to`, `subject`                                                                 |
| SES refused it         | error | `kind`, `error` (the AWS name), `statusCode`, `requestId`, `detail`, `recipients`, `subject` |
| refused before sending | error | `kind`, `reason`                                                                             |
| log only, production   | error | `recipients`, `subject`                                                                      |
| log only, elsewhere    | info  | `to`, `cc`, `bcc`, `subject`, attachment names, `body` (first 800 characters)                |

`detail` is the AWS error message with every email address replaced by `[address]`. It keeps what an
AccessDenied says (the ARN missing from the IAM policy, the usual cause) and drops what a MessageRejected says
about the recipient. A message that "never arrived" with no error line at all is a suppression or a
deliverability question: see the `ses-deliverability` skill.

## 8. `esc()`

```js
import { esc } from '@coderize/email'

html: `<p>Hi ${esc(user.firstName)},</p><p>${esc(org.name)} invited you.</p>`
```

Escapes `& < > " '`, so it is safe in text and in a quoted attribute. `null` and `undefined` become `''`, not
`"null"`. Escape every interpolated value in HTML and none in the text body. A URL in `href` needs a check that
it is http(s) before it is escaped: `esc()` doesn't make `javascript:` safe. A display name built from user data
goes in `from` as it is: the mailer quotes or encodes it.

## 9. Testing an app that sends

Inject a fake client and set the env, so the SES path runs without AWS:

```js
const client = { send: vi.fn().mockResolvedValue({ MessageId: 'test-1' }) }
const mailer = createMailer({ from: 'App <no-reply@app.com>', client, logger: app.log, env: { EMAIL_PROVIDER: 'ses' } })

await mailer.send(message)
expect(client.send.mock.calls[0][0].input).toMatchObject({ Destination: { ToAddresses: ['jane@test.com'] } })
```

Or leave `EMAIL_PROVIDER` unset in the test env and assert on the `logged` result. Never set
`EMAIL_PROVIDER=ses` in a test without injecting `client`: the mailer would build a real one from whatever AWS
credentials the machine has.

## 10. SNS notices: `@coderize/email/sns`

The route that receives SES bounce, complaint and delivery events (or inbound mail) over an SNS HTTPS
subscription is public, so nothing in a message is trusted until its signature checks out. No AWS SDK and no
Fastify inside, so a Lambda can use it too.

```js
// src/routes/sesEvents.js
import { confirmSubscription, verifySnsMessage } from '@coderize/email/sns'

export default async function sesEventRoutes(app) {
  // SNS posts JSON as text/plain.
  app.addContentTypeParser('text/plain', { parseAs: 'string' }, (request, body, done) => {
    try {
      done(null, JSON.parse(body))
    } catch (err) {
      err.statusCode = 400
      done(err)
    }
  })

  app.post('/', async (request, reply) => {
    const message = request.body
    if (!(await verifySnsMessage(message, { topicArn: process.env.SES_SNS_TOPIC_ARN }))) {
      return reply.code(403).send({ error: 'Invalid SNS message', code: 'SNS_INVALID' })
    }
    if (message.Type === 'SubscriptionConfirmation') {
      const { ok } = await confirmSubscription(message)
      return { confirmed: ok }
    }
    // message.Type === 'Notification': JSON.parse(message.Message) is the SES event.
    return { received: true }
  })
}
```

**`verifySnsMessage(message, { topicArn, fetchCert })`** resolves `true` or `false` and never throws. It
requires, in order:

1. `SignatureVersion` 1 (SHA1withRSA) or 2 (SHA256withRSA), and a `Signature`.
2. The `TopicArn` is `topicArn` (one ARN or a list), when given. Always pin it: without it, any topic in any
   account can deliver a validly signed message to the route.
3. `SigningCertURL` is HTTPS on **exactly** `sns.<region>.amazonaws.com`, the region read from the message's own
   `TopicArn`, with no port and no credentials, ending in `.pem`. A pattern such as `sns.<anything>.amazonaws.com`
   also accepts `sns.s3.amazonaws.com`, an S3 bucket hostname anyone could have created, which would let them
   sign forged notices with a key of their own (gronetworking #207, coderize-dev-mono #410). A subscription
   message's `SubscribeURL` is held to the same rule.
4. The signature verifies over the canonical string with that certificate's public key.

The certificate is fetched with a 5-second timeout and no redirects, must be valid now, and is cached by URL
(at most 20) until it expires. `fetchCert` replaces the download in tests; `fetchSigningCert(url, { fetch })` is
the default.

**`confirmSubscription(message, { fetch })`** GETs the `SubscribeURL` of a verified `SubscriptionConfirmation`,
after checking it against the same host rule, with the same timeout and no redirects. It throws when the URL
fails the check and resolves `{ ok, status }` otherwise.

`topicRegion(arn)`, `isSnsUrl(url, { region, pem })` and `signingString(message)` are the pieces, exported for
routes with their own error handling.

## Moving an app onto it

One PR per app, keeping every call site's behaviour:

1. Add the dependency, build the mailer once (above), and point the app's own `sendEmail` wrapper at
   `mailer.send` or `mailer.trySend`, or replace it. Delete the app's SES client, MIME builder and escaper.
2. Check what each caller passes as `to`: a string or a flat list, never a list wrapped again.
3. Map the result the callers read: ThawWatch's `messageId` is `id`; dmarc's `{ id }` is unchanged; TakeUrOwn's
   boolean is `result.ok && result.status === 'sent'`.
4. Move the switch to `EMAIL_PROVIDER=ses` in SSM where the app used something else (TakeUrOwn's
   `EMAIL_ENABLED=1`), in the same deploy.
5. Leave `configurationSet` unset unless the app already passed one (coderize-dev, GRO).
6. After the deploy, send through the app's own mailer inside the running container to
   `success@simulator.amazonses.com` and check for a MessageId, then send one message with an attachment to a
   real mailbox and open the file.

## Versions

Semver from what a consuming app feels: a **patch** changes nothing it can see, a **minor** adds an export or an
option, and a **major** changes a result, an error or what goes over the wire. Renovate merges minors and
patches by itself and holds majors for review.

Every release is staged on npm and goes live only once a maintainer approves it with 2FA.
