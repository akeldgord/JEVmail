export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS installation (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  account_email TEXT NOT NULL,
  encrypted_refresh_token TEXT,
  startup_watermark_ms INTEGER NOT NULL,
  processed_label_id TEXT,
  paused INTEGER NOT NULL DEFAULT 0,
  needs_reconnect INTEGER NOT NULL DEFAULT 0,
  poll_interval_seconds INTEGER NOT NULL DEFAULT 60,
  max_per_minute INTEGER NOT NULL DEFAULT 30,
  max_per_hour INTEGER NOT NULL DEFAULT 300,
  max_per_day INTEGER NOT NULL DEFAULT 2000,
  backlog_batch_size INTEGER NOT NULL DEFAULT 25,
  daily_spend_cents INTEGER,
  last_poll_at INTEGER,
  last_poll_status TEXT
);
CREATE TABLE IF NOT EXISTS classifier_configs (
  hash TEXT PRIMARY KEY, provider TEXT NOT NULL, model TEXT NOT NULL,
  global_instructions TEXT NOT NULL, taxonomy_json TEXT NOT NULL,
  created_at INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS classification_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT, message_id TEXT NOT NULL,
  config_hash TEXT NOT NULL, label_id TEXT NOT NULL,
  probabilities_json TEXT NOT NULL, confidence REAL,
  provider TEXT NOT NULL, model TEXT NOT NULL, usage_json TEXT,
  created_at INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'success',
  UNIQUE(message_id, config_hash, status)
);
CREATE TABLE IF NOT EXISTS message_audits (
  message_id TEXT PRIMARY KEY, thread_id TEXT NOT NULL,
  label_id TEXT NOT NULL, config_hash TEXT NOT NULL,
  confidence REAL, probabilities_json TEXT NOT NULL,
  provider TEXT NOT NULL, model TEXT NOT NULL, usage_json TEXT,
  processed_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS manual_corrections (
  id INTEGER PRIMARY KEY AUTOINCREMENT, message_id TEXT NOT NULL,
  from_label_id TEXT NOT NULL, to_label_id TEXT NOT NULL, corrected_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS backlog_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, range_json TEXT NOT NULL,
  status TEXT NOT NULL, total INTEGER NOT NULL DEFAULT 0,
  processed INTEGER NOT NULL DEFAULT 0, failed INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS backlog_failures (
  job_id INTEGER NOT NULL, message_id TEXT NOT NULL, kind TEXT NOT NULL,
  created_at INTEGER NOT NULL, PRIMARY KEY(job_id, message_id)
);
CREATE TABLE IF NOT EXISTS usage_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL,
  input_tokens INTEGER, cost_cents INTEGER, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS processing_errors (
  id INTEGER PRIMARY KEY AUTOINCREMENT, stage TEXT NOT NULL,
  category TEXT NOT NULL, provider TEXT, status INTEGER, detail TEXT,
  message_id TEXT, created_at INTEGER NOT NULL
);
`;

