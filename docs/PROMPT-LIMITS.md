# TypeSafe prompt-size bounds

JEVmail v3 separates **provider capacity** from **application safety bounds**.

## Published provider schema

As of 2026-10-02, the TypeSafe OpenAPI schema at `https://api.typesafe.ai/openapi.json` defines `ChoiceQuestion.instructions` and `ChoiceQuestion.criteria` but does not publish a `maxLength` for either field.

Because the provider schema does not expose a hard text-size ceiling, JEVmail does not claim that 8,000 characters is the TypeSafe maximum.

## JEVmail application bounds

JEVmail intentionally uses conservative limits with headroom:

- criteria JSON: **8,000 characters**
- each criterion: **240 characters**
- instructions sent to Jev: **4,000 characters**
- enabled labels: **20**

These are application guardrails, not claimed provider maxima. Save-time validation enforces them. Runtime classification degrades with deterministic truncation rather than throwing if an invalid config is forced into storage.

## Credentialed probe

Run:

```bash
npm run probe:prompt-limits
```

The script sends synthetic choice questions targeting approximately 4k, 8k, 16k, and 32k criteria characters and prints the HTTP status, latency, and first 1,000 response characters for each request.

Required environment variables:

```text
JEVMODEL_API_KEY
JEV_MODEL
JEV_BASE_URL   # optional; defaults to https://api.typesafe.ai
```

Do not commit API keys or raw probe output containing sensitive provider/account data.

If a future credentialed probe establishes a stable lower provider ceiling, reduce JEVmail's application bounds and add the observed response shape here.
