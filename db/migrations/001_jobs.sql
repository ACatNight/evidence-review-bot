CREATE SCHEMA IF NOT EXISTS review_bot;

CREATE TABLE IF NOT EXISTS review_bot.webhook_delivery (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  installation_id text NOT NULL,
  delivery_id text NOT NULL,
  event_type text NOT NULL,
  repository_id text NOT NULL,
  pull_request_id text NOT NULL,
  payload_digest text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (provider, installation_id, delivery_id)
);

CREATE TABLE IF NOT EXISTS review_bot.review_job (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('snapshot', 'analysis')),
  delivery_id uuid REFERENCES review_bot.webhook_delivery(id),
  run_id uuid,
  repository_id text NOT NULL,
  pull_request_id text NOT NULL,
  state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued', 'running', 'retrying', 'completed', 'failed')),
  priority integer NOT NULL DEFAULT 0,
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5 CHECK (max_attempts > 0),
  available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  lease_owner text,
  lease_until timestamptz,
  lease_generation bigint NOT NULL DEFAULT 0,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((kind = 'snapshot' AND delivery_id IS NOT NULL AND run_id IS NULL)
      OR (kind = 'analysis' AND run_id IS NOT NULL)),
  CHECK ((state = 'running' AND lease_owner IS NOT NULL AND lease_until IS NOT NULL)
      OR (state <> 'running' AND lease_owner IS NULL AND lease_until IS NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS review_job_snapshot_delivery
  ON review_bot.review_job (delivery_id) WHERE kind = 'snapshot';

CREATE INDEX IF NOT EXISTS review_job_claimable
  ON review_bot.review_job (priority DESC, available_at, id)
  WHERE state IN ('queued', 'retrying', 'running');

CREATE TABLE IF NOT EXISTS review_bot.audit_event (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  delivery_id uuid REFERENCES review_bot.webhook_delivery(id),
  job_id uuid REFERENCES review_bot.review_job(id),
  action text NOT NULL,
  redacted_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
