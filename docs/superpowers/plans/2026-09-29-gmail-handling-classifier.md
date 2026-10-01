# Gmail Handling Classifier Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a public, self-hosted Gmail application that classifies each eligible inbox message exactly once into one handling-oriented label using Jev, with a privacy-first dashboard, backlog controls, rate/spend limits, and audit-only corrections.

**Architecture:** Build a modular TypeScript monolith with a Next.js dashboard plus a polling worker that share a SQLite/Drizzle datastore. Gmail, classification, rate limiting, and persistence are isolated behind interfaces so core processing can be tested without external credentials; Jev is the first `Classifier` implementation, not a hard-coded product dependency.

**Tech Stack:** TypeScript, Node.js, Next.js App Router, React, Vitest, Drizzle ORM, SQLite (`better-sqlite3`), Auth.js Google OAuth, Google Gmail API, Zod, Docker Compose, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-29-gmail-handling-classifier-design.md`

## Global Constraints

- Classify by **required handling**, not by subject matter.
- Every successfully processed Gmail message receives exactly one enabled visible classification label.
- `Reply Needed` outranks all non-reply categories; `Action Needed` outranks all categories except `Reply Needed`.
- `Indeterminate` is always available and cannot be disabled.
- A Gmail message is classified successfully at most once; the hidden Gmail processed label is the durable processing source of truth.
- The product only applies labels in v1: never archive, delete, mark read, forward, move, or otherwise mutate message state.
- Normal startup processes only inbox mail arriving after the initial startup watermark; historical mail runs only through an explicit backlog job.
- Backlog jobs are date-bounded by user choice and are pausable, resumable, cancellable, and rate/spend limited.
- Current message context includes sender, recipients, subject, cleaned body, attachment metadata, and up to three immediately preceding thread messages.
- Do not persist email bodies, thread text, attachment contents, extracted attachment text, or full classifier request payloads.
- Manual corrections change the Gmail classification label and audit record only; they do not invoke the classifier or alter future classifier guidance.
- Dashboard authentication is Google-only and restricted to the same Google account connected to Gmail processing.
- Docker Compose is the supported v1 deployment path; no Redis, Postgres, Pub/Sub, Kubernetes, or distributed queue.
- Jev provider configuration is server-side only. Use a pinned model identifier in production configuration; never depend on `latest` for a tuned production classifier.
- Provider retries must reuse a stable idempotency key when supported.

## Review Focus

1. **Crash after Jev succeeds but before Gmail processed-marker write:** the next attempt must not create uncontrolled duplicate paid inference; a persisted attempt result and stable provider idempotency key must permit safe recovery.
2. **Crash after visible classification label is applied but before processed marker:** retry must reconcile labels idempotently, preserve exactly one classification label, and finish without generating a second successful classification.
3. **Thread/message payload exceeds provider input limits:** context builder must deterministically trim lower-priority historical content before current-message content and must never persist the trimmed source text.
4. **Google account mismatch or revoked OAuth grant:** worker must stop processing, dashboard must require reconnect, and no Gmail action may occur under another account.
5. **Taxonomy/config changes while a backlog is running:** already processed messages remain immutable; each attempt records the exact classifier config hash it used, and future items use the active config without retroactive reclassification.

---

## File Structure

Create the project with the following responsibility boundaries:

```text
src/
  app/
    (auth)/signin/page.tsx
    api/auth/[...nextauth]/route.ts
    api/test-classifier/route.ts
    api/backlog/route.ts
    api/corrections/route.ts
    dashboard/page.tsx
    dashboard/triage/page.tsx
    dashboard/labels/page.tsx
    dashboard/classifier/page.tsx
    dashboard/processing/page.tsx
    dashboard/audit/page.tsx
    layout.tsx
    page.tsx
  auth/
    auth.ts
    google-account.ts
    token-crypto.ts
  classifier/
    types.ts
    jev-client.ts
    jev-classifier.ts
    prompt-builder.ts
  config/
    env.ts
  db/
    client.ts
    schema.ts
    migrations/
    repositories/
      installation-repo.ts
      taxonomy-repo.ts
      audit-repo.ts
      attempt-repo.ts
      backlog-repo.ts
      usage-repo.ts
  domain/
    taxonomy.ts
    defaults.ts
    config-version.ts
  gmail/
    types.ts
    gmail-client.ts
    labels.ts
    messages.ts
    context-builder.ts
    normalize-message.ts
  processing/
    processor.ts
    retry-policy.ts
    limiter.ts
    polling.ts
    backlog.ts
    worker.ts
  services/
    triage-service.ts
    correction-service.ts
    classifier-test-service.ts
  ui/
    components/
      nav.tsx
      status-card.tsx
      probability-list.tsx
      correction-select.tsx
      backlog-form.tsx
      taxonomy-editor.tsx
      classifier-console.tsx
  worker-entry.ts

tests/
  unit/
  integration/
  fixtures/

drizzle.config.ts
vitest.config.ts
Dockerfile
docker-compose.yml
.env.example
.github/workflows/ci.yml
README.md
```

Keep provider SDK/wire details inside `src/classifier/jev-client.ts`; Gmail wire details inside `src/gmail/`; all once-only semantics inside `src/processing/processor.ts`; and all persistence of operational metadata inside repository modules.

---

### Task 1: Bootstrap the repository and testable application shell

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `next.config.ts`
- Create: `vitest.config.ts`
- Create: `src/config/env.ts`
- Create: `src/app/layout.tsx`
- Create: `src/app/page.tsx`
- Create: `tests/unit/config/env.test.ts`
- Create: `.gitignore`
- Create: `.env.example`

**Interfaces:**
- Consumes: none.
- Produces: `env` validated server configuration from `src/config/env.ts`; project scripts `dev`, `build`, `lint`, `typecheck`, `test`, `test:watch`.

- [ ] **Step 1: Write the failing environment-validation test**

Test `tests/unit/config/env.test.ts` so `parseEnv({})` reports missing `APP_URL`, `AUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `JEVMODEL_API_KEY`, `JEV_MODEL`, and `APP_ENCRYPTION_KEY`; assert `JEV_BASE_URL` defaults to `https://jevmodel.org` and optional rate/poll settings receive defaults.

- [ ] **Step 2: Run the test and verify RED**

Run: `npm test -- tests/unit/config/env.test.ts`

Expected: FAIL because `parseEnv` does not exist.

- [ ] **Step 3: Scaffold Next.js/TypeScript/Vitest and implement `parseEnv(input: Record<string, string | undefined>): AppEnv`**

Use Zod. Mark secrets server-only. Require `APP_URL`, `AUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `JEVMODEL_API_KEY`, `JEV_MODEL`, and `APP_ENCRYPTION_KEY`; `JEV_BASE_URL` defaults to `https://jevmodel.org`. Defaults: poll interval `60` seconds; per-minute/hour/day limits `30/300/2000`; backlog batch size `25`. Keep values configurable rather than embedding provider-specific limits in the processing layer.

- [ ] **Step 4: Verify shell quality gates**

Run: `npm test -- tests/unit/config/env.test.ts && npm run typecheck && npm run lint && npm run build`

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add .
git commit -m "chore: bootstrap mail triage app"
```

---

### Task 2: Define handling taxonomy and classifier configuration versioning

**Files:**
- Create: `src/domain/taxonomy.ts`
- Create: `src/domain/defaults.ts`
- Create: `src/domain/config-version.ts`
- Create: `tests/unit/domain/taxonomy.test.ts`
- Create: `tests/unit/domain/config-version.test.ts`

**Interfaces:**
- Consumes: none.
- Produces: `ClassificationLabel`, `ClassificationTaxonomy`, `SemanticRole`, `ClassifierConfigSnapshot`, `DEFAULT_TAXONOMY`, `validateTaxonomy(taxonomy)`, `hashClassifierConfig(config): string`.

- [ ] **Step 1: Write taxonomy invariant tests**

Assert that the default taxonomy contains the 12 approved labels in precedence order; `reply_needed`, `action_needed`, and `indeterminate` have protected semantic roles; `Indeterminate` cannot be disabled; duplicate stable IDs are rejected; and at least two enabled labels remain available.

- [ ] **Step 2: Run taxonomy tests and verify RED**

Run: `npm test -- tests/unit/domain/taxonomy.test.ts`

Expected: FAIL because domain types/defaults do not exist.

- [ ] **Step 3: Implement domain types/default taxonomy/validation**

Use stable internal IDs independent of editable display names. Encode precedence as explicit numeric priority rather than array position only.

- [ ] **Step 4: Write config-hash tests**

Assert equivalent classifier configs hash identically despite object key insertion order; changing global instructions, enabled labels, label guidance, provider, or model changes the hash. Production config validation rejects aliases such as `latest` and requires a version-pinned model identifier.

- [ ] **Step 5: Implement canonical configuration hashing**

Implement `hashClassifierConfig(config: ClassifierConfigSnapshot): string` using stable canonical JSON + SHA-256.

- [ ] **Step 6: Verify**

Run: `npm test -- tests/unit/domain && npm run typecheck`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/domain tests/unit/domain
git commit -m "feat: define handling taxonomy"
```

---

### Task 3: Add SQLite schema, repositories, and privacy boundaries

**Files:**
- Create: `drizzle.config.ts`
- Create: `src/db/client.ts`
- Create: `src/db/schema.ts`
- Create: `src/db/repositories/installation-repo.ts`
- Create: `src/db/repositories/taxonomy-repo.ts`
- Create: `src/db/repositories/audit-repo.ts`
- Create: `src/db/repositories/attempt-repo.ts`
- Create: `src/db/repositories/backlog-repo.ts`
- Create: `src/db/repositories/usage-repo.ts`
- Create: `tests/integration/db/repositories.test.ts`
- Create: `tests/unit/db/privacy.test.ts`

**Interfaces:**
- Consumes: domain taxonomy/config hash from Task 2.
- Produces: repositories for installation, taxonomy/config, attempts, audits/corrections, backlog jobs, and usage windows. `ClassificationAttempt` may persist provider result metadata/probabilities but never message content.

- [ ] **Step 1: Write repository round-trip tests**

Cover: single installation identity/watermark; taxonomy persistence; attempt keyed by Gmail message ID + config hash; audit record; correction history; backlog state; usage counters.

- [ ] **Step 2: Write privacy schema tests**

Assert the Drizzle schema exposes no columns named or semantically representing `body`, `bodyText`, `threadText`, `rawMessage`, `attachmentContent`, or `promptPayload` in audit/attempt tables.

- [ ] **Step 3: Run DB tests and verify RED**

Run: `npm test -- tests/integration/db tests/unit/db/privacy.test.ts`

Expected: FAIL because schema/repositories do not exist.

- [ ] **Step 4: Implement schema and repositories**

Tables: `installation`, `classification_labels`, `classifier_configs`, `classification_attempts`, `message_audits`, `manual_corrections`, `backlog_jobs`, `usage_events`. The installation row points to the active immutable classifier-config snapshot and stores editable processing defaults/overrides. Use unique constraint on Gmail message ID for completed audit records. Store probabilities/usage as JSON metadata only. Configure SQLite WAL mode and a busy timeout for concurrent web/worker access. Add `db:generate` and `db:migrate` scripts to `package.json`.

- [ ] **Step 5: Generate first migration and verify DB tests**

Run: `npm run db:generate && npm test -- tests/integration/db tests/unit/db/privacy.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json drizzle.config.ts src/db tests/integration/db tests/unit/db
git commit -m "feat: add privacy-first persistence"
```

---

### Task 4: Implement Google authentication, encrypted token storage, and Gmail label management

**Files:**
- Create: `src/auth/token-crypto.ts`
- Create: `src/auth/google-account.ts`
- Create: `src/auth/auth.ts`
- Create: `src/services/setup-service.ts`
- Create: `src/app/api/auth/[...nextauth]/route.ts`
- Create: `src/app/(auth)/signin/page.tsx`
- Create: `src/gmail/types.ts`
- Create: `src/gmail/gmail-client.ts`
- Create: `src/gmail/labels.ts`
- Create: `tests/unit/auth/token-crypto.test.ts`
- Create: `tests/unit/auth/google-account.test.ts`
- Create: `tests/unit/gmail/labels.test.ts`

**Interfaces:**
- Consumes: environment config and installation/taxonomy repositories.
- Produces: authenticated Google session; encrypted Gmail refresh-token persistence; `GmailClient`; `ensureClassificationLabels()`; `ensureProcessedLabel()`; `ensureInstallationSetup()`.

- [ ] **Step 1: Write token-encryption tests**

Assert AES-256-GCM encrypt/decrypt round-trips; ciphertext differs from plaintext; wrong key/auth tag fails; logs/error objects never include the raw token.

- [ ] **Step 2: Implement `encryptSecret` / `decryptSecret`**

Derive a fixed 32-byte application key from `APP_ENCRYPTION_KEY`; store IV + auth tag + ciphertext, never the plain refresh token.

- [ ] **Step 3: Write Google-account binding tests**

Assert initial OAuth connection binds the installation email; later sign-in with another Google account is rejected; revoked/absent refresh credentials produce `needsReconnect` rather than falling through.

- [ ] **Step 4: Implement Auth.js Google provider and Gmail credential capture**

Request only identity scopes plus the Gmail scope required to read message content and add/remove labels. Request offline access/consent so the worker can obtain a refresh token, persist that token encrypted through the installation repository, and restrict dashboard sessions to the bound account.

- [ ] **Step 5: Write Gmail-label tests with a fake client**

Assert classification labels are created/mapped idempotently; processed marker is created with Gmail list/message visibility hidden; repeated setup reuses existing label IDs; manual correction can remove one classification label and add another without touching non-app labels.

- [ ] **Step 6: Implement Gmail label adapter**

Keep all Google API label request/response mapping in `src/gmail/labels.ts`. `setup-service.ts` seeds the default taxonomy/config on the first bound login, ensures visible labels plus the hidden processed marker exist, and records the initial startup watermark without processing historical mail.

- [ ] **Step 7: Verify**

Run: `npm test -- tests/unit/auth tests/unit/gmail/labels.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/auth src/services/setup-service.ts src/app/api/auth src/app/'(auth)' src/gmail tests/unit/auth tests/unit/gmail/labels.test.ts
git commit -m "feat: add google auth and gmail labels"
```

---

### Task 5: Build Gmail message retrieval and privacy-safe context normalization

**Files:**
- Create: `src/gmail/messages.ts`
- Create: `src/gmail/normalize-message.ts`
- Create: `src/gmail/context-builder.ts`
- Create: `tests/fixtures/gmail-thread.ts`
- Create: `tests/unit/gmail/normalize-message.test.ts`
- Create: `tests/unit/gmail/context-builder.test.ts`

**Interfaces:**
- Consumes: `GmailClient` from Task 4.
- Produces: `NormalizedMessage`, `MessageContext`, `fetchMessageContext(messageId, maxPriorMessages = 3)`, `serializeContextForClassifier(context, maxChars)`.

- [ ] **Step 1: Write normalization tests**

Cover plain text, HTML-only email, common quoted-reply separators, repeated prior-message blocks, signatures, whitespace, missing body, and attachment metadata. Assert attachment contents are never returned.

- [ ] **Step 2: Implement message normalization**

Prefer meaningful `text/plain`; otherwise sanitize/convert HTML to text. Remove obvious quoted duplicate blocks/signature boilerplate conservatively rather than deleting uncertain user content.

- [ ] **Step 3: Write thread-context tests**

Assert current message plus at most three immediately preceding thread messages are included in chronological context; later/future thread messages are excluded; sender/recipient/subject/attachment metadata are preserved.

- [ ] **Step 4: Add provider-limit trimming tests (Review Focus #3)**

Assert serialization stays under a supplied `maxChars`; trimming removes oldest prior messages first, then compresses lower-priority metadata, and preserves current subject/sender/current body as long as possible. Empty/attachment-only messages remain representable for `Indeterminate` handling.

- [ ] **Step 5: Implement `serializeContextForClassifier`**

Make trimming deterministic for identical input and limit.

- [ ] **Step 6: Verify**

Run: `npm test -- tests/unit/gmail/normalize-message.test.ts tests/unit/gmail/context-builder.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/gmail tests/fixtures tests/unit/gmail
git commit -m "feat: build gmail message context"
```

---

### Task 6: Implement the generic classifier contract and Jev adapter

**Files:**
- Create: `src/classifier/types.ts`
- Create: `src/classifier/prompt-builder.ts`
- Create: `src/classifier/jev-client.ts`
- Create: `src/classifier/jev-classifier.ts`
- Create: `tests/unit/classifier/prompt-builder.test.ts`
- Create: `tests/unit/classifier/jev-classifier.test.ts`

**Interfaces:**
- Consumes: `MessageContext`, serialized context, taxonomy, config hash.
- Produces: `Classifier.classify(request): Promise<ClassificationResult>`; `JevClassifier`; `ClassificationResult { labelId, probabilities, confidence, provider, model, usage, configHash }`.

- [ ] **Step 1: Write prompt/question builder tests**

Assert one Jev `choice` question is generated from enabled taxonomy labels; option IDs are stable internal IDs; global handling-first instructions and per-label guidance are included; reply/action precedence is explicit; `Indeterminate` is always present; disabled labels are absent.

- [ ] **Step 2: Implement prompt/question builder**

Keep Jev criteria compact enough for provider limits and validate option count before sending.

- [ ] **Step 3: Write Jev adapter tests against a fake HTTP transport**

Assert request uses configurable base URL, pinned model, bearer key, serialized state, one bounded `choice` question, and stable `Idempotency-Key`. Assert response choice/probabilities/confidence/usage map to `ClassificationResult`; unknown/disabled label response is rejected; 401/402/422 are permanent errors; 429/5xx/timeouts are transient.

- [ ] **Step 4: Implement `JevClient` and `JevClassifier`**

Default official endpoint should be configurable; keep wire format isolated. Use `idempotencyKey = sha256(gmailMessageId + configHash)` for production message classifications; test-console calls use a unique non-production key and never create message attempts.

- [ ] **Step 5: Add low-context fallback test**

For an attachment-only/insufficient context case, assert the request still includes `Indeterminate` and the application does not fabricate attachment contents.

- [ ] **Step 6: Verify**

Run: `npm test -- tests/unit/classifier && npm run typecheck`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/classifier tests/unit/classifier
git commit -m "feat: add jev classifier adapter"
```

---

### Task 7: Implement provider-independent rate and spend governor

**Files:**
- Create: `src/processing/limiter.ts`
- Create: `tests/unit/processing/limiter.test.ts`

**Interfaces:**
- Consumes: usage repository and current settings.
- Produces: `RateGovernor.canStart(now): Promise<LimitDecision>` and `RateGovernor.recordUsage(event)`.

- [ ] **Step 1: Write rate-window tests**

Assert per-minute/hour/day limits block only new classifications and unblock when windows expire; changing settings takes effect without rewriting historical usage events.

- [ ] **Step 2: Write spend-ceiling tests**

Assert configured daily spend blocks when provider cost metadata reaches ceiling; when provider reports token usage but no reliable cost, usage remains visible but spend ceiling is reported unavailable rather than guessed.

- [ ] **Step 3: Implement limiter**

Use persisted usage events and deterministic rolling/calendar windows. Return structured reason codes for dashboard display.

- [ ] **Step 4: Verify and commit**

Run: `npm test -- tests/unit/processing/limiter.test.ts`

Expected: PASS.

```bash
git add src/processing/limiter.ts tests/unit/processing/limiter.test.ts
git commit -m "feat: add processing limits"
```

---

### Task 8: Implement exactly-once message processing and failure recovery

**Files:**
- Create: `src/processing/retry-policy.ts`
- Create: `src/processing/processor.ts`
- Create: `tests/unit/processing/processor.test.ts`
- Create: `tests/integration/processing/recovery.test.ts`

**Interfaces:**
- Consumes: Gmail message/context adapter, Gmail label adapter, classifier, audit/attempt repos, rate governor, active taxonomy/config.
- Produces: `processMessage(messageId): Promise<ProcessOutcome>` with outcomes `processed | already_processed | deferred | failed_permanent | failed_transient`.

- [ ] **Step 1: Write happy-path/once-only tests**

Assert unprocessed inbox message is classified once, one visible classification label is applied, hidden processed marker is applied, audit is committed, usage is recorded; second call sees marker and does not invoke classifier.

- [ ] **Step 2: Implement minimal happy path**

Check Gmail processed marker before any classifier call. Validate classifier result against active taxonomy before Gmail writes.

- [ ] **Step 3: Add crash/failure tests from Review Focus #1 and #2**

Scenarios:
- classifier succeeds, visible-label write fails;
- visible label succeeds, processed-marker write fails;
- processed marker succeeds, local audit commit fails;
- process restarts with a persisted successful attempt but no marker.

Assertions: no duplicate paid provider request is necessary when a reusable attempt exists; Gmail writes are idempotent; exactly one app classification label remains; completion is defined by Gmail processed marker.

- [ ] **Step 4: Implement persisted attempt reuse and reconciliation**

Persist only classification output metadata/result after provider success, never message text. On retry, reuse the attempt if message ID + config hash match; otherwise a new active config may be used only if no successful attempt exists.

- [ ] **Step 5: Add retry-policy tests**

Assert transient Gmail/Jev errors back off with bounded attempts; permanent provider/config/auth errors are surfaced without infinite retry; rate-limit decisions return `deferred` without classifier calls.

- [ ] **Step 6: Implement retry policy and structured errors**

Do not sleep inside unit-testable core processor; worker scheduler owns retry timing.

- [ ] **Step 7: Verify**

Run: `npm test -- tests/unit/processing/processor.test.ts tests/integration/processing/recovery.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/processing/retry-policy.ts src/processing/processor.ts tests/unit/processing tests/integration/processing
git commit -m "feat: enforce exactly-once classification"
```

---

### Task 9: Implement startup watermark, polling worker, and normal incoming-mail flow

**Files:**
- Create: `src/processing/polling.ts`
- Create: `src/processing/worker.ts`
- Create: `src/worker-entry.ts`
- Modify: `package.json`
- Create: `tests/unit/processing/polling.test.ts`
- Create: `tests/integration/processing/incoming-flow.test.ts`

**Interfaces:**
- Consumes: installation repo, Gmail query adapter, processor.
- Produces: `initializeWatermark()`, `pollOnce()`, `runWorker(signal)`.

- [ ] **Step 1: Write first-start tests**

Assert first successful setup records a watermark without classifying older inbox messages; later polls query only eligible inbox messages after watermark and exclude processed-marker messages.

- [ ] **Step 2: Implement watermark and Gmail search query builder**

Use Gmail timestamps/query semantics through the Gmail adapter; keep query construction in one place and test string/parameter generation.

- [ ] **Step 3: Write worker pause/auth/rate-limit tests**

Assert global pause, reconnect-required state, or rate exhaustion prevents classifier work while keeping the worker alive and reporting status.

- [ ] **Step 4: Implement polling loop**

`pollOnce()` remains deterministic and testable. `runWorker()` owns timing, shutdown signal handling, and bounded retry scheduling. Add a `worker` package script that runs `src/worker-entry.ts` under Node/tsx in development and the compiled worker entry in production.

- [ ] **Step 5: Verify**

Run: `npm test -- tests/unit/processing/polling.test.ts tests/integration/processing/incoming-flow.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json src/processing/polling.ts src/processing/worker.ts src/worker-entry.ts tests/unit/processing/polling.test.ts tests/integration/processing/incoming-flow.test.ts
git commit -m "feat: process new inbox mail"
```

---

### Task 10: Implement backlog estimation and pausable/resumable jobs

**Files:**
- Create: `src/processing/backlog.ts`
- Create: `src/app/api/backlog/route.ts`
- Create: `tests/unit/processing/backlog.test.ts`
- Create: `tests/integration/processing/backlog-flow.test.ts`

**Interfaces:**
- Consumes: Gmail search/count adapter, backlog repo, processor, rate governor.
- Produces: `estimateBacklog(range)`, `createBacklogJob(range)`, `runBacklogBatch(jobId)`, `pauseBacklog(jobId)`, `resumeBacklog(jobId)`, `cancelBacklog(jobId)`.

- [ ] **Step 1: Write date-range query tests**

Cover 30 days, 90 days, 1 year, custom start/end, and entire current inbox. Assert processed-marker messages are excluded and no job starts during estimation.

- [ ] **Step 2: Implement estimation**

Return eligible message count plus available provider usage/cost estimate. If precise cost is unavailable, return token/call estimate with an explicit `costEstimateUnavailable` flag rather than inventing dollars.

- [ ] **Step 3: Write lifecycle tests**

Assert job starts pending, processes at most configured batch size, can pause/resume/cancel, preserves completed messages, updates counts, and respects global rate/spend limits.

- [ ] **Step 4: Add config-change-during-backlog test (Review Focus #5)**

Assert each item records the config hash actually used; completed messages remain immutable; unprocessed later items may use the newly active config.

- [ ] **Step 5: Implement backlog manager and API route**

API route requires authenticated bound Google account and supports estimate/start/pause/resume/cancel actions.

- [ ] **Step 6: Verify and commit**

Run: `npm test -- tests/unit/processing/backlog.test.ts tests/integration/processing/backlog-flow.test.ts`

Expected: PASS.

```bash
git add src/processing/backlog.ts src/app/api/backlog tests/unit/processing/backlog.test.ts tests/integration/processing/backlog-flow.test.ts
git commit -m "feat: add controlled backlog processing"
```

---

### Task 11: Implement triage, manual correction, audit, and classifier test services

**Files:**
- Create: `src/services/triage-service.ts`
- Create: `src/services/correction-service.ts`
- Create: `src/services/classifier-test-service.ts`
- Create: `src/app/api/corrections/route.ts`
- Create: `src/app/api/test-classifier/route.ts`
- Create: `tests/unit/services/correction-service.test.ts`
- Create: `tests/unit/services/classifier-test-service.test.ts`

**Interfaces:**
- Consumes: Gmail labels/messages, classifier, taxonomy/config, audit repo.
- Produces: recent triage views, audit views, `correctClassification(messageId, labelId)`, `testClassifier(sample): ClassificationResult`.

- [ ] **Step 1: Write correction tests**

Assert correction removes the old app classification label, adds exactly one new enabled label, preserves hidden processed marker, records original/new labels and timestamp, and never invokes classifier.

- [ ] **Step 2: Implement correction service/API**

Reject disabled/unknown target labels. Keep non-app Gmail labels untouched.

- [ ] **Step 3: Write classifier-console tests**

Assert pasted sample/current Gmail sample can invoke classifier without creating attempts, audits, processed markers, or Gmail mutations; returned probabilities/model/config hash/usage are displayed to caller.

- [ ] **Step 4: Implement test service/API**

Use same prompt builder and taxonomy as production, but a non-production idempotency namespace.

- [ ] **Step 5: Add account-mismatch/revocation tests (Review Focus #4)**

Assert both correction and test routes reject another Google identity; Gmail-dependent operations report reconnect when grant is invalid.

- [ ] **Step 6: Verify and commit**

Run: `npm test -- tests/unit/services`

Expected: PASS.

```bash
git add src/services src/app/api/corrections src/app/api/test-classifier tests/unit/services
git commit -m "feat: add triage correction and test services"
```

---

### Task 12: Build the authenticated dashboard and configuration workflows

**Files:**
- Create: `src/app/dashboard/page.tsx`
- Create: `src/app/dashboard/triage/page.tsx`
- Create: `src/app/dashboard/labels/page.tsx`
- Create: `src/app/dashboard/labels/actions.ts`
- Create: `src/app/dashboard/classifier/page.tsx`
- Create: `src/app/dashboard/classifier/actions.ts`
- Create: `src/app/dashboard/processing/page.tsx`
- Create: `src/app/dashboard/processing/actions.ts`
- Create: `src/app/dashboard/audit/page.tsx`
- Create: `src/ui/components/nav.tsx`
- Create: `src/ui/components/status-card.tsx`
- Create: `src/ui/components/probability-list.tsx`
- Create: `src/ui/components/correction-select.tsx`
- Create: `src/ui/components/backlog-form.tsx`
- Create: `src/ui/components/taxonomy-editor.tsx`
- Create: `src/ui/components/classifier-console.tsx`
- Create: `tests/unit/ui/dashboard.test.tsx`

**Interfaces:**
- Consumes: authenticated services/APIs from Tasks 4, 10, 11 and repositories/settings.
- Produces: five-area dashboard described in the spec.

- [ ] **Step 1: Write route/auth smoke tests**

Assert unauthenticated dashboard access redirects to sign-in; authenticated bound user can reach all five sections; account mismatch shows blocked/reconnect state.

- [ ] **Step 2: Build navigation and overview**

Overview displays processing status, classifications today, pending/failed count, correction rate, last poll, and usage/spend when available.

- [ ] **Step 3: Build Inbox Triage and Audit pages**

Triage shows sender/subject/label/confidence/time with correction control; message body is fetched on demand and never written into local DB. Audit shows IDs, original/current label, probabilities, model/config hash, correction history, usage.

- [ ] **Step 4: Build Labels page**

Allow rename, guidance editing, enable/disable optional labels, Gmail mapping, while preventing disabling protected `Indeterminate` and preserving semantic roles for Reply/Action/Indeterminate. Mutations use authenticated server actions and create a new immutable classifier-config snapshot/config hash rather than rewriting historical snapshots.

- [ ] **Step 5: Build Classifier page**

Allow global instruction edit, pinned model selection/config, config version display, and test console with probability distribution and usage. Saving classifier behavior creates a new immutable config snapshot and makes it active for future unprocessed messages only.

- [ ] **Step 6: Build Processing page**

Controls: pause/resume, poll interval, minute/hour/day limits, backlog batch size, daily spend ceiling when supported, backlog estimate/start/pause/resume/cancel. Persist these settings through authenticated server actions. Require a confirmation screen for backlog showing eligible count and spend/usage warning.

- [ ] **Step 7: Verify UI and type checks**

Run: `npm test -- tests/unit/ui/dashboard.test.tsx && npm run typecheck && npm run build`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/app/dashboard src/ui tests/unit/ui
git commit -m "feat: add mail triage dashboard"
```

---

### Task 13: Package Docker deployment, CI, setup docs, and end-to-end fake-provider test

**Files:**
- Create: `Dockerfile`
- Create: `docker-compose.yml`
- Create: `.github/workflows/ci.yml`
- Create: `tests/integration/e2e/fake-mail-flow.test.ts`
- Create: `README.md`
- Modify: `.env.example`
- Modify: `package.json`

**Interfaces:**
- Consumes: complete application.
- Produces: supported self-host install, credential-free CI, full fake Gmail/Jev integration test.

- [ ] **Step 1: Write end-to-end fake-provider test**

Simulate OAuth-bound installation, first-start watermark, one new inbox email, bounded thread context, Jev classification, Gmail visible label + hidden marker, audit write, second poll skip, manual correction, and backlog estimate. Assert no persisted DB record contains email body text.

- [ ] **Step 2: Run E2E test and fix any integration gaps**

Run: `npm test -- tests/integration/e2e/fake-mail-flow.test.ts`

Expected: PASS only when the cross-module contract is complete.

- [ ] **Step 3: Add Docker image and Compose configuration**

Persist SQLite in a named volume. Run web and worker as explicit processes from the same image/codebase. Add healthcheck. Secrets come from environment/secret files, never image layers.

- [ ] **Step 4: Add GitHub Actions CI**

On push/PR run install, lint, typecheck, unit/integration tests, and production build without Gmail or Jev credentials.

- [ ] **Step 5: Write README**

Lead with: “Most email classifiers organize your inbox by what messages are about. This one organizes it by what you need to do.” Document prerequisites, Google OAuth setup, Jev key/model configuration, Docker Compose install, default taxonomy, privacy model, once-only behavior, backlog cost warning, rate/spend controls, and v1 non-goals.

- [ ] **Step 6: Run final verification**

Run: `npm run lint && npm run typecheck && npm test && npm run build && docker compose config`

Expected: all PASS; Compose config resolves without secrets committed.

- [ ] **Step 7: Commit**

```bash
git add Dockerfile docker-compose.yml .github README.md .env.example package.json tests/integration/e2e
git commit -m "docs: package self-hosted release"
```

---

## Implementation Completion Gate

Before opening the final PR or merging:

- Run all quality gates from Task 13.
- Confirm the hidden Gmail marker is the first check before any production classifier call.
- Confirm no schema/log path persists email bodies/thread text.
- Confirm the Gmail adapter has no archive/delete/read-state operations.
- Confirm exactly one app classification label is present after normal processing and after manual correction.
- Confirm normal startup cannot process historical inbox mail before the watermark.
- Confirm backlog requires explicit user action and presents eligible-count + usage/spend warning.
- Confirm the production classifier config pins a specific model identifier rather than `latest`.
- Run a final whole-branch code review before merge.
