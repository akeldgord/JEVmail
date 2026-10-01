# JEVmail

**Most email classifiers organize your inbox by what messages are about. This one organizes it by what you need to do.**

JEVmail is a privacy-first, self-hosted Gmail classifier built around bounded decision models such as [Jev](https://jevmodel.org/). It applies **exactly one handling label** to each new inbox message so Gmail becomes a set of practical queues: mail to answer, mail to act on, records to keep, transient codes, low-value bulk mail, and so on.

JEVmail does **not** archive, delete, mark read, forward, or otherwise act on your mail in v1. It labels only.

## Why handling-first classification?

Topic folders are often a poor proxy for what you actually need to do. A hotel confirmation and a hotel asking you to confirm your arrival time are both "travel," but they have very different handling requirements.

JEVmail therefore applies this precedence:

1. **Reply Needed** — a legitimate conversational response from you is expected.
2. **Action Needed** — you need to do something, but replying is not the primary action.
3. **Reservation / Confirmation** — travel, appointments, tickets, registrations, bookings, and similar reference material.
4. **Receipt / Record** — receipts, paid invoices, statements, donation records, and other records worth retaining.
5. **Account / Security Notice** — sign-in alerts, password/account changes, and security notices that do not themselves require action.
6. **Verification / One-Time Code** — login codes, verification links, password-reset codes, and other transient credentials.
7. **Shipping / Delivery** — tracking, delivery, pickup, and shipment-status notices.
8. **FYI / No Action** — legitimate information worth seeing that requires neither response nor action.
9. **Newsletter / Subscription** — recurring informational mail.
10. **Cold Marketing** — unsolicited sales, lead generation, vendor pitches, and similar outreach.
11. **Political** — campaigns, fundraising, advocacy, PAC, and party communications.
12. **Indeterminate** — the message does not fit the enabled taxonomy with enough confidence.

**Reply Needed** and **Action Needed** override lower categories. A payment-due notice is Action Needed rather than Receipt / Record. A hotel asking you a question is Reply Needed rather than Reservation / Confirmation. Cold unsolicited outreach remains Cold Marketing merely because the sender asks for a meeting.

The defaults are editable in the dashboard. Each classification still resolves to exactly one enabled label or Indeterminate. Classifier categories may map only to Gmail **user labels**; Gmail system labels such as `INBOX`, `TRASH`, and `SPAM` are rejected defensively.

## Core guarantees

### Each message is classified once

Normal processing is intentionally one-shot:

1. JEVmail checks for its hidden processed marker before calling the classifier.
2. A successful classifier result is persisted before Gmail label reconciliation.
3. The visible handling label is applied.
4. The hidden `JEVmail/Processed` marker is applied.
5. Audit metadata is written.

If Gmail fails after a successful Jev decision, the persisted result is reused on retry instead of paying for another inference. Jev requests also use a stable idempotency key for production classifications.

The hidden marker is configured not to appear in Gmail's normal label list or message label chips. It still exists as a user label and may be visible in Gmail label settings.

### New mail only by default

On first successful setup, JEVmail records a startup watermark. The normal worker processes only messages that arrive in the Inbox after that watermark. It will **not silently churn through your historical inbox**.

Older mail is handled through the explicit **Clear Backlog** workflow, where you choose:

- last 30 days
- last 90 days
- last year
- a custom date range
- the entire current Inbox

JEVmail estimates eligible-message count and usage before starting. Provider-dollar estimates are shown only when reliable cost metadata exists; otherwise the UI explicitly says the spend estimate is unavailable. Backlog jobs can be paused, resumed, or cancelled and are subject to the same rate/spend limits as new mail.

### Privacy-first storage

JEVmail does **not** create a shadow mailbox.

The local SQLite database stores operational metadata such as Gmail message/thread IDs, assigned labels, probability distributions, timestamps, classifier/config version, processing state, usage, and correction history. It does **not** persist:

- email bodies
- prior thread text
- attachments or extracted attachment contents
- classifier prompt payloads containing mail content

When the dashboard needs message content, it fetches it from Gmail on demand. Production logs are designed around IDs/statuses rather than mail bodies.

### Bounded thread context

For classification, JEVmail uses the current message plus at most the **three immediately preceding messages** in the Gmail thread. Quoted chains, signatures, and obvious HTML cruft are normalized before inference. Attachment **metadata** may be included, but attachment contents are not inspected in v1.

## Dashboard

The web UI provides:

- **Overview** — processing health, today's classifications, correction rate, usage, backlog status, and last poll.
- **Triage** — recent classifications, confidence/probabilities, live message context, and manual corrections.
- **Labels** — edit label names/descriptions, enable or disable categories, and map classifier categories to Gmail labels.
- **Classifier** — edit global instructions, select a pinned model, and run a no-side-effect test console.
- **Processing** — pause/resume, edit per-minute/hour/day limits, optional daily spend ceiling, and manage backlog jobs.
- **Audit** — inspect classification/correction history without storing message bodies.

Manual corrections are **audit-only in v1**. They fix the Gmail label and record the correction, but do not silently train, reweight, or rewrite future classifier behavior.

## Architecture

JEVmail is a modular monolith packaged as one image with two explicit processes:

- `web` — Next.js dashboard and authenticated server routes
- `worker` — Gmail polling + incoming-mail/backlog processing

Both share one SQLite database volume. External systems sit behind adapters so a future Jev-like bounded decision model can replace the current classifier without rewriting Gmail ingestion or dashboard logic.

The runtime currently uses Node's built-in SQLite API with explicit repositories. Drizzle tooling remains in the project as a possible future migration path, but is not required at runtime.

## Requirements

- Docker + Docker Compose (recommended), or Node.js **22.6+**
- a Google account with Gmail
- a Google Cloud OAuth application with the Gmail API enabled
- a Jev API key
- a pinned Jev production model identifier (the example configuration uses `jev-1.13.0`)

## Google OAuth setup

JEVmail is intended for a single user per installation. Each self-hoster creates their own Google OAuth credentials.

1. Create or select a project in Google Cloud Console.
2. Enable the **Gmail API**.
3. Configure the OAuth consent screen for your account/test users as required by Google.
4. Create an **OAuth 2.0 Web application** client.
5. Add this authorized redirect URI:

   ```text
   http://localhost:3000/api/auth/callback/google
   ```

   If you deploy JEVmail at another HTTPS URL, replace the origin with your exact `APP_URL`.
6. Put the client ID and client secret in `.env`.

JEVmail requests the `gmail.modify` Gmail scope because it must read messages and apply/remove labels. The connected Google identity is bound to the installation; a different account cannot use the dashboard to control the configured mailbox.

> Publishing a broadly distributed Gmail app may trigger additional Google OAuth verification requirements. A personal self-hosted/test-user installation can follow Google's normal OAuth testing rules.

## Install with Docker Compose

Clone the repository, then:

```bash
cp .env.example .env
```

Generate **different** random values for `AUTH_SECRET` and `APP_ENCRYPTION_KEY`. For example:

```bash
openssl rand -hex 32
```

Edit `.env` and set at minimum:

```dotenv
APP_URL=http://localhost:3000
NEXTAUTH_URL=http://localhost:3000
AUTH_SECRET=<random secret>
APP_ENCRYPTION_KEY=<different random secret>
GOOGLE_CLIENT_ID=<google oauth client id>
GOOGLE_CLIENT_SECRET=<google oauth client secret>
JEVMODEL_API_KEY=<jev api key>
JEV_MODEL=jev-1.13.0
```

Start both processes:

```bash
docker compose up -d --build
```

Open `http://localhost:3000` and sign in with the Google account whose Gmail you want JEVmail to classify.

Useful commands:

```bash
# Follow web + worker logs
docker compose logs -f

# Stop without deleting the SQLite volume
docker compose down

# Stop and intentionally delete local JEVmail state
docker compose down -v
```

Deleting the local database does not remove Gmail labels already applied to messages. The hidden processed marker exists in Gmail specifically to help prevent accidental reclassification after local-state loss.

## Processing and spend controls

Defaults can be provided by environment variables and then changed in the dashboard:

| Setting | Default |
| --- | ---: |
| Poll interval | 60 seconds |
| Max classifications/minute | 30 |
| Max classifications/hour | 300 |
| Max classifications/day | 2,000 |
| Backlog batch size | 25 |
| Daily spend ceiling | unset |

The app enforces its own minute/hour/day limits independently of Jev's upstream service limits. A dollar ceiling can only be enforced from reliable cost metadata; if the provider does not return it, JEVmail reports spend as unavailable rather than inventing an estimate.

## Classifier configuration

The classifier contract is provider-neutral: a normalized email context plus a fixed taxonomy goes in; one bounded label plus probabilities/confidence/usage comes out.

For Jev:

- use a **pinned production model**, not `latest` or a preview alias
- the request uses one bounded `choice` question
- production retries reuse the same idempotency key
- JEVmail trims normalized state before inference to stay within the provider's state budget

Classifier settings are versioned immutably. Editing label guidance or global instructions affects only messages that have not yet been classified.

## Development

Install dependencies:

```bash
npm install
```

Run the core provider-independent suite:

```bash
npm run test:core
```

Run all tests, including the React dashboard smoke test:

```bash
npm test
```

Other checks:

```bash
npm run lint
npm run typecheck
npm run build
```

CI runs install, lint, typecheck, tests, production build, and Compose validation without real Gmail or Jev credentials. Integration tests use fake providers and must never call real Gmail/Jev services.

## v1 non-goals

JEVmail v1 intentionally does **not**:

- archive, delete, mark read/unread, forward, or move messages
- generate new labels dynamically
- assign multiple classifier labels to one message
- inspect attachment contents or use vision/OCR
- use Gmail push/Pub/Sub notifications
- learn automatically from manual corrections
- reclassify already-processed messages automatically
- operate as a multi-user hosted SaaS

These constraints are deliberate: v1 aims to make the classification decision useful, inspectable, inexpensive, and safe before automating downstream mail actions.

## Security notes

- Never commit `.env`; it is ignored by git and Docker build context.
- OAuth refresh tokens are encrypted before local persistence using `APP_ENCRYPTION_KEY`.
- Use HTTPS and strong random secrets for any deployment beyond localhost.
- Treat the SQLite volume and `.env` as sensitive data even though mail bodies are not persisted.

## Status

JEVmail is early software. The core processing, privacy, retry/idempotency, backlog, and fake-provider integration behavior are covered by automated tests. Real Gmail/Jev credentials are intentionally not required in CI.
