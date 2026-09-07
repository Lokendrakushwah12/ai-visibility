-- AI visibility: crawler/referral log + LLM prompt tracking.
--
-- SQLite / libSQL (Turso, D1) below; a Postgres variant follows at the bottom.
-- Adapt table and column names to the host project's conventions - the shapes
-- and the index set are the parts that matter.

CREATE TABLE IF NOT EXISTS ai_visits (
  id          text    PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  ts          integer NOT NULL DEFAULT (unixepoch()),
  kind        text    NOT NULL,          -- 'crawl' | 'referral'
  agent       text    NOT NULL,          -- 'OAI-SearchBot', 'chatgpt.com', ...
  vendor      text    NOT NULL,          -- 'openai', 'anthropic', ...
  purpose     text    NOT NULL,          -- 'train' | 'search' | 'user' | 'dev' | 'referral'
  path        text    NOT NULL,
  ip          text,                      -- raw, so verification can run later
  user_agent  text,
  referer     text,
  country     text,
  verified    integer                    -- NULL unchecked, 1 in vendor range, 0 failed/unprovable
);

CREATE INDEX IF NOT EXISTS ai_visits_ts_idx         ON ai_visits (ts);
CREATE INDEX IF NOT EXISTS ai_visits_agent_ts_idx   ON ai_visits (agent, ts);
CREATE INDEX IF NOT EXISTS ai_visits_kind_ts_idx    ON ai_visits (kind, ts);
CREATE INDEX IF NOT EXISTS ai_visits_path_idx       ON ai_visits (path);
-- Partial: the verifier only ever scans rows it hasn't checked, and this table
-- is the one that grows without bound.
CREATE INDEX IF NOT EXISTS ai_visits_unverified_idx ON ai_visits (ts) WHERE verified IS NULL;

CREATE TABLE IF NOT EXISTS ai_prompt_runs (
  id          text    PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  ts          integer NOT NULL DEFAULT (unixepoch()),
  run_date    text    NOT NULL,          -- YYYY-MM-DD, groups a day's runs
  prompt_id   text    NOT NULL,          -- stable series key, never renumber
  prompt      text    NOT NULL,          -- denormalised: prompts get reworded
  provider    text    NOT NULL,
  model       text    NOT NULL,
  mode        text    NOT NULL DEFAULT 'retrieval',  -- 'memory' | 'retrieval' | 'index'
  mentioned   integer NOT NULL DEFAULT 0,
  position    integer,                   -- rank among named brands; raw rank in index mode
  cited       integer NOT NULL DEFAULT 0,
  cited_urls  text    NOT NULL DEFAULT '[]',
  competitors text    NOT NULL DEFAULT '[]',
  answer      text,                      -- keep it: explains *why* a score moved
  error       text
);

CREATE INDEX IF NOT EXISTS ai_prompt_runs_date_idx     ON ai_prompt_runs (run_date);
CREATE INDEX IF NOT EXISTS ai_prompt_runs_prompt_idx   ON ai_prompt_runs (prompt_id, run_date);
CREATE INDEX IF NOT EXISTS ai_prompt_runs_provider_idx ON ai_prompt_runs (provider, run_date);
CREATE INDEX IF NOT EXISTS ai_prompt_runs_mode_idx     ON ai_prompt_runs (mode, run_date);

-- ─────────────────────────────────────────────────────────────────────────────
-- Postgres variant
--
--   id          uuid PRIMARY KEY DEFAULT gen_random_uuid()
--   ts          timestamptz NOT NULL DEFAULT now()
--   verified    boolean                       -- NULL still means "unchecked"
--   cited_urls  jsonb NOT NULL DEFAULT '[]'
--   competitors jsonb NOT NULL DEFAULT '[]'
--   mentioned   boolean NOT NULL DEFAULT false
--   cited       boolean NOT NULL DEFAULT false
--
-- Use CHECK constraints or enums for kind/purpose/mode rather than bare text,
-- and keep the same index set. The partial index becomes:
--   CREATE INDEX ai_visits_unverified_idx ON ai_visits (ts) WHERE verified IS NULL;
--
-- Retention, either dialect - add it on day one, not when the table is huge:
--   DELETE FROM ai_visits WHERE ts < unixepoch() - 60*60*24*180;   -- SQLite
--   DELETE FROM ai_visits WHERE ts < now() - interval '180 days';  -- Postgres
