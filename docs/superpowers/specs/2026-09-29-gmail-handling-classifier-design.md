# Gmail Handling Classifier — Design Spec

**Date:** 2026-09-29
**Status:** Approved
**Scope:** v1 self-hosted single-user Gmail classifier

## 1. Product thesis

The product classifies email by **required handling**, not by subject matter.

Most email classifiers ask: **“What is this email about?”**

This product asks: **“What does the user need to do with this email?”**

The classifier applies exactly one fixed Gmail label to each eligible message. It never archives, deletes, marks read, forwards, or otherwise changes message state in v1.

The system is optimized for triage behavior such as:

- save messages that require a reply;
- save messages that require an action but not necessarily a response;
- keep reservations, confirmations, receipts, and security notices for later reference;
- separate transient codes and shipping updates;
- make low-value classes such as political email, cold marketing, and newsletters easy to bulk review and delete;
- fall back to `Indeterminate` when no label is a good fit.

The product will be public on GitHub and designed for other users to self-host for their own Gmail account.

## 2. Core classification model

### 2.1 Exactly-one-label invariant

Every successfully classified Gmail message receives exactly one visible classification label from the enabled taxonomy.

The classifier may not:

- generate free-form labels;
- apply multiple classification labels;
- omit a label after a successful classification;
- silently reclassify a previously processed message.

`Indeterminate` is always available as the fallback classification.

### 2.2 Handling precedence

The default taxonomy is ordered by handling priority rather than topic:

1. **Reply Needed**
2. **Action Needed**
3. **Reservation / Confirmation**
4. **Receipt / Record**
5. **Account / Security Notice**
6. **Verification / One-Time Code**
7. **Shipping / Delivery**
8. **FYI / No Action**
9. **Newsletter / Subscription**
10. **Cold Marketing**
11. **Political**
12. **Indeterminate**

`Reply Needed` and `Action Needed` are override categories.

Examples:

- “Your hotel is confirmed” → `Reservation / Confirmation`
- “Please confirm your hotel arrival time” → `Reply Needed`
- “Invoice attached for your records” → `Receipt / Record`
- “Invoice due Friday — click here to pay” → `Action Needed`
- campaign fundraising email → `Political`
- unsolicited salesperson asking for a meeting → `Cold Marketing`, not `Reply Needed`
- login code → `Verification / One-Time Code`
- suspicious-login notice asking the user to secure the account → `Action Needed`

`Reply Needed` means a legitimate conversational obligation, not merely that a sender asked a question. This prevents cold sales outreach and similar solicitations from being promoted into the reply queue.

### 2.3 Taxonomy configuration

The application ships with the default taxonomy above.

The web UI allows the user to:

- rename visible labels;
- edit label descriptions and classifier guidance;
- enable or disable non-required categories;
- map classifier labels to Gmail labels;
- edit the global classifier instructions.

Internally, `Reply Needed`, `Action Needed`, and `Indeterminate` retain protected semantic roles even if their visible names are changed.

## 3. Classifier architecture

### 3.1 Provider abstraction

The application depends on a generic classifier interface rather than hard-coding the product around one model vendor.

Conceptual contract:

```ts
interface Classifier {
  classify(
    context: MessageContext,
    taxonomy: ClassificationTaxonomy,
    config: ClassifierConfig,
  ): Promise<ClassificationResult>;
}
```

`ClassificationResult` includes at minimum:

- selected label ID;
- probability/confidence data returned by the provider;
- provider/model identifier;
- provider usage/cost metadata when available;
- configuration version/hash.

Jev is the initial/reference classifier implementation. Future Jev-like bounded-decision models can be added behind the same interface without changing Gmail ingestion, audit storage, rate limiting, or dashboard behavior.

### 3.2 Classifier prompt/configuration

Classifier behavior has two editable layers:

1. **Global classification instructions** — the handling-first heuristic and precedence rules.
2. **Per-label guidance** — definition, inclusion/exclusion guidance, and examples for each label.

Manual corrections do not automatically modify either layer in v1.

### 3.3 Test console

The dashboard includes a classifier test console where the user can paste or select sample email content and run the current classifier configuration without applying labels to Gmail.

The test console displays:

- selected label;
- probability/confidence output;
- provider/model;
- configuration version;
- usage/cost metadata when available.

Test-console runs are never treated as production classifications and never mark Gmail messages as processed.

## 4. Message context and normalization

For each eligible message, the classifier receives:

- sender;
- recipients;
- subject;
- cleaned current message body;
- attachment metadata only (for example filename and MIME type);
- up to the three immediately preceding messages from the same Gmail thread.

The application does not inspect attachment contents in v1.

Before classification, message context is normalized to remove or reduce:

- quoted duplicate thread content;
- repetitive signatures;
- tracking boilerplate;
- excessive HTML markup;
- irrelevant whitespace and formatting noise.

The normalized context must be trimmed to the active classifier provider’s input limits. If the meaningful content exists only in an unsupported attachment or insufficient context remains after normalization, the classifier should prefer `Indeterminate` rather than infer unsupported facts.

## 5. Processing semantics

### 5.1 Once-only processing invariant

Each Gmail message is eligible for successful classification exactly once.

Normal lifecycle:

```text
unprocessed
    ↓
fetch + normalize context
    ↓
classify once
    ↓
apply one visible handling label
    ↓
apply hidden processed marker
    ↓
record audit metadata
    ↓
complete permanently
```

Once the hidden processed marker is successfully applied, the message is considered complete and is not automatically reclassified even if:

- the model changes;
- the label taxonomy changes;
- the global instructions change;
- the application is restarted;
- the local database is restored from an older copy.

Explicit manual correction is allowed, but that correction changes the Gmail classification label without invoking the classifier again.

### 5.2 Hidden processed marker

The application creates a dedicated Gmail user label such as:

`MailTriage/Processed`

It should be configured to remain hidden from the normal label list and message-label display where Gmail permits.

This marker is the durable Gmail-side guard against automatic reprocessing.

### 5.3 Source of truth

Gmail is the source of truth for whether a message has already been processed.

The local database is the source of truth for:

- audit history;
- usage statistics;
- manual corrections;
- processing state for active jobs;
- classifier configuration versions.

## 6. Normal incoming-mail workflow

On first successful setup, the application records a startup watermark/cursor.

Normal operation processes only messages that:

- arrive after that initial watermark;
- are in the Gmail Inbox;
- do not already carry the hidden processed marker.

The v1 ingestion mechanism is polling.

Each poll cycle:

1. query Gmail for eligible new inbox messages;
2. skip messages already carrying the processed marker;
3. fetch and normalize the current message plus bounded thread context;
4. send the context to the classifier;
5. validate that exactly one enabled label was returned;
6. apply the visible Gmail classification label;
7. apply the hidden processed marker;
8. persist local audit metadata;
9. update usage/rate-limit counters.

Polling frequency is configurable.

Gmail push notifications are explicitly out of scope for v1, but ingestion boundaries should not prevent adding them later.

## 7. Backlog workflow

The application does not automatically classify historical inbox mail at startup.

The dashboard includes a deliberate **Clear Backlog** workflow.

The user may choose:

- last 30 days;
- last 90 days;
- last year;
- custom date range;
- entire current Inbox.

Before a backlog job begins, the application shows:

- estimated number of eligible messages;
- current configured classification rate;
- estimated provider usage/cost where available;
- a clear warning that large jobs may incur significant model spend.

Backlog jobs are:

- pausable;
- resumable;
- cancellable;
- subject to the same once-only processing rules as normal incoming mail.

Cancellation stops future work only. Messages already successfully classified remain complete.

## 8. Rate limiting and spend controls

Rate limiting is enforced by the application, not delegated solely to the classifier provider.

The web UI exposes configurable controls for:

- maximum classifications per minute;
- maximum classifications per hour;
- maximum classifications per day;
- backlog batch size/concurrency;
- optional daily spend ceiling when provider usage data makes this feasible;
- global pause/resume of classification.

When a limit is reached, the application pauses new classifications without losing queue state and resumes when the relevant limit resets or the user changes configuration.

These controls are provider-independent so future classifiers inherit the same safeguards.

## 9. Failure handling and idempotency

Retries are permitted only for unfinished messages.

Transient failures include:

- Gmail API timeout/5xx;
- classifier timeout/5xx;
- temporary OAuth refresh failure;
- network interruption.

Permanent or configuration failures are surfaced in the dashboard and remain unresolved until corrected.

The write sequence is:

1. classify;
2. apply visible classification label;
3. apply hidden processed marker;
4. commit local audit record.

Gmail label writes must be idempotent.

If classification succeeds but a Gmail write fails before the processed marker is applied, retry logic may reuse the already-obtained in-memory classification within that processing attempt when safe, but must not treat the message as complete until the marker exists.

The implementation must avoid uncontrolled retry loops that cause repeated paid inference after a successful classifier result. A short-lived persisted “classification attempt” record containing only metadata/result output, not email content, may be used to make this recovery safe.

## 10. Manual corrections

The triage dashboard lets the user change an incorrectly assigned visible classification label.

A correction:

- updates the Gmail classification label;
- records the original label;
- records the corrected label;
- records the correction timestamp;
- preserves the original classifier output/probabilities;
- does not invoke the classifier again;
- does not alter future prompts or label guidance automatically.

Corrections are audit-only in v1.

A simple quality metric such as `manual corrections / total classifications` is displayed to help the user evaluate classifier quality.

## 11. Dashboard

The web application contains five primary areas.

### 11.1 Inbox Triage

Shows recent classifications with:

- sender;
- subject;
- assigned label;
- probability/confidence;
- classification timestamp;
- manual correction control.

Email body content is fetched from Gmail on demand and is not persisted locally.

### 11.2 Labels

Allows the user to:

- manage the taxonomy;
- edit definitions/instructions;
- enable/disable optional labels;
- edit Gmail label mappings.

### 11.3 Classifier

Shows and controls:

- global classification instructions;
- current provider/model;
- classifier configuration version;
- test console;
- returned probability distributions;
- provider usage/cost metadata when available.

### 11.4 Processing

Shows and controls:

- poll status;
- last successful poll;
- pause/resume;
- configured rate limits;
- daily usage/spend;
- backlog controls;
- backlog progress;
- failed-message count;
- recent processing errors.

### 11.5 Audit

Shows:

- Gmail message ID;
- original classification;
- correction history;
- classifier/model identifier;
- configuration version;
- timestamps;
- probability/confidence metadata;
- usage/cost metadata.

No email body or attachment content is stored in the audit database.

## 12. Privacy and security

### 12.1 Privacy-first storage

The local database stores operational metadata only.

Persisted data may include:

- Gmail message ID;
- Gmail thread ID;
- selected label;
- probability/confidence metadata;
- processing status;
- timestamps;
- provider/model identifier;
- classifier configuration hash/version;
- manual correction history;
- provider usage/cost metadata;
- backlog job state;
- rate-limit counters.

The application does not persist:

- email bodies;
- quoted thread text;
- attachment contents;
- extracted attachment text;
- full classifier request payloads containing email text.

### 12.2 Authentication

The dashboard uses Google sign-in only.

Access is restricted to the same Google account whose Gmail mailbox is connected for classification.

There is no separate local username/password system in v1.

If Gmail authorization is revoked or expires beyond refresh capability:

- processing pauses;
- no email is classified;
- the dashboard presents a reconnect state.

### 12.3 Secret handling

OAuth tokens and provider credentials must:

- never appear in application logs;
- never be committed to source control;
- be stored using secure local secret/configuration mechanisms appropriate to the deployment;
- be encrypted at rest where practical for the supported deployment path.

### 12.4 Logging

Production logs may contain:

- message IDs;
- thread IDs;
- job IDs;
- provider/model identifiers;
- status codes;
- timing;
- error categories.

Production logs must not contain email bodies, thread contents, attachment contents, OAuth tokens, or provider secrets.

Debug logging retains the same redaction default.

## 13. Deployment architecture

### 13.1 Architectural style

The v1 application is a **modular monolith** packaged for self-hosting.

Internal modules remain separated by explicit interfaces:

- web/dashboard;
- authentication;
- Gmail adapter;
- ingestion/polling;
- processing engine;
- classifier interface;
- Jev classifier adapter;
- taxonomy/configuration;
- audit/usage persistence;
- scheduler/rate limiter;
- backlog job manager.

The application should not require a distributed queue or external database in v1.

### 13.2 Supported deployment

Docker Compose is the supported v1 deployment path.

The core architecture remains deployment-agnostic so later documentation or adapters may support cloud/serverless hosting without rewriting the classifier or Gmail core.

## 14. Technology stack

Recommended v1 stack:

- **TypeScript / Node.js**
- **Next.js** for the dashboard and authenticated server routes
- **SQLite** for local operational metadata
- **Drizzle ORM** for schema and migrations
- **Google OAuth** for dashboard authentication and Gmail authorization
- **Gmail API** for message access and label management
- **Jev** as the initial classifier provider behind the generic classifier interface
- **Docker Compose** for supported self-hosted deployment

The application runs as one deployable product. The web server and polling worker may run as separate internal processes/services while sharing the same application code and SQLite datastore.

Explicitly excluded from v1 unless implementation constraints require otherwise:

- Redis;
- Postgres;
- Kubernetes;
- Google Pub/Sub;
- distributed job queues;
- automatic mailbox actions beyond labeling;
- attachment OCR/vision;
- automatic learning from corrections.

## 15. Data model

The exact schema will be defined in the implementation plan, but v1 requires at least the following conceptual entities.

### User / Installation

Single-user installation configuration containing:

- connected Google account identity;
- Gmail mailbox identity;
- startup watermark;
- polling configuration;
- global processing state.

### Classification Label

Contains:

- stable internal ID;
- visible name;
- semantic role where applicable;
- classifier description/guidance;
- enabled state;
- priority/precedence metadata;
- Gmail label ID/name mapping.

### Classifier Configuration

Contains:

- provider;
- model identifier;
- global instructions;
- configuration version/hash;
- provider-specific settings that are safe to persist.

### Message Audit Record

Contains:

- Gmail message ID;
- Gmail thread ID;
- selected label ID;
- classifier/model identifier;
- classifier configuration version/hash;
- probability/confidence metadata;
- timestamps;
- usage/cost metadata;
- correction state.

No email body is stored.

### Manual Correction

Contains:

- message ID;
- original label;
- corrected label;
- correction timestamp.

### Backlog Job

Contains:

- selected date range;
- status;
- estimated eligible count;
- processed count;
- failed count;
- timestamps;
- pause/cancel state.

### Usage / Rate State

Contains counters/windows required for:

- per-minute limits;
- per-hour limits;
- per-day limits;
- daily spend ceiling.

## 16. Testing strategy

The codebase must isolate Gmail and classifier providers behind adapters so the core processing engine can be tested without external credentials.

Required automated test coverage includes:

- handling precedence;
- exactly-one-label invariant;
- `Indeterminate` fallback;
- once-only processing;
- hidden-marker behavior;
- retry/idempotency behavior;
- failure before and after visible-label application;
- backlog date-range selection;
- pause/resume/cancel behavior;
- rate-limit enforcement;
- spend-ceiling enforcement where usage data exists;
- manual correction audit behavior;
- Gmail label mapping;
- classifier adapter contract;
- configuration versioning;
- privacy assertions proving email bodies/thread text are not persisted.

CI must run unit and integration tests without requiring live Gmail or Jev credentials.

A separate opt-in live integration test path may be documented for developers with real credentials.

## 17. v1 non-goals

The following are intentionally outside v1:

- automatic archive/delete/mark-read behavior;
- multi-label classification;
- model-generated new labels;
- automatic retraining or prompt modification from corrections;
- attachment OCR or vision;
- multi-user SaaS hosting;
- Gmail push notifications;
- distributed scaling;
- historical mailbox processing without explicit user initiation;
- automatic reclassification after taxonomy/model changes.

## 18. Success criteria

v1 is successful when a self-hosting user can:

1. deploy the application with Docker Compose;
2. sign in with Google and connect one Gmail account;
3. review and modify the default handling-oriented taxonomy;
4. configure Jev and processing/spend limits;
5. start the application without touching historical inbox mail;
6. have each new inbox message classified exactly once into one visible label;
7. see `Reply Needed` and `Action Needed` correctly outrank lower-priority categories;
8. inspect classifications and probability/confidence data in the dashboard;
9. manually correct a classification without creating a feedback loop;
10. run a date-bounded backlog job with an explicit cost warning;
11. pause/resume processing safely;
12. operate the system without locally persisting email bodies or attachment contents.

## 19. Product positioning

Primary message:

> **Most email classifiers organize your inbox by what messages are about. This one organizes it by what you need to do.**

The practical value is not merely cleaner categorization. It is converting the inbox into handling queues:

- messages to answer;
- tasks to complete;
- records to keep;
- temporary information to consume;
- low-value mail that can be reviewed and discarded in bulk.

That handling-first heuristic is the defining product behavior and should remain central to the UI, documentation, default taxonomy, and classifier configuration.
