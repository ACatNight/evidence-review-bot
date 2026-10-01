ALTER TABLE review_bot.review_report
  ADD COLUMN ai_review jsonb NOT NULL DEFAULT
    '{"state":"not_run","model":null,"inspectedFiles":0,"eligibleFiles":0,"findings":[],"reason":"disabled"}'::jsonb;
