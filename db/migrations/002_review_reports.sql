ALTER TABLE review_bot.webhook_delivery
  ADD COLUMN base_sha text,
  ADD COLUMN head_sha text;

CREATE TABLE review_bot.review_report (
  job_id uuid PRIMARY KEY REFERENCES review_bot.review_job(id),
  installation_id text NOT NULL,
  repository_id text NOT NULL,
  pull_request_id text NOT NULL,
  merge_base_sha text NOT NULL,
  base_sha text NOT NULL,
  head_sha text NOT NULL,
  rule_version text NOT NULL,
  coverage jsonb NOT NULL,
  findings jsonb NOT NULL,
  publication_state text NOT NULL DEFAULT 'pending'
    CHECK (publication_state IN ('pending', 'publishing', 'published', 'uncertain', 'superseded')),
  check_run_id bigint,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX review_report_pending ON review_bot.review_report (publication_state, created_at);
