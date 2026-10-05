CREATE TABLE IF NOT EXISTS customers (
 id text PRIMARY KEY, store_id text NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
 telegram_user_id text NOT NULL, telegram_chat_id text NOT NULL, name text NOT NULL, username text,
 opted_in boolean NOT NULL DEFAULT true, tags jsonb NOT NULL DEFAULT '[]', segments jsonb NOT NULL DEFAULT '[]',
 vip_level integer NOT NULL DEFAULT 0, points integer NOT NULL DEFAULT 0, state jsonb NOT NULL DEFAULT '{}',
 last_seen_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS customers_store_telegram_unique ON customers(store_id,telegram_user_id);
CREATE INDEX IF NOT EXISTS customers_store_seen_idx ON customers(store_id,last_seen_at);
CREATE TABLE IF NOT EXISTS growth_resources (
 id text PRIMARY KEY, store_id text NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
 kind text NOT NULL, name text NOT NULL, enabled boolean NOT NULL DEFAULT false, status text NOT NULL DEFAULT 'draft',
 configuration jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS growth_resources_store_kind_idx ON growth_resources(store_id,kind);
CREATE TABLE IF NOT EXISTS growth_jobs (
 id text PRIMARY KEY, store_id text NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
 resource_id text REFERENCES growth_resources(id) ON DELETE CASCADE, customer_id text REFERENCES customers(id) ON DELETE CASCADE,
 dedupe_key text NOT NULL, payload jsonb NOT NULL, status text NOT NULL DEFAULT 'queued', attempts integer NOT NULL DEFAULT 0,
 available_at timestamptz NOT NULL DEFAULT now(), locked_until timestamptz, last_error text, completed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS growth_jobs_store_dedupe_unique ON growth_jobs(store_id,dedupe_key);
CREATE INDEX IF NOT EXISTS growth_jobs_status_available_idx ON growth_jobs(status,available_at);
CREATE TABLE IF NOT EXISTS customer_point_ledger (
 id text PRIMARY KEY, store_id text NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
 customer_id text NOT NULL REFERENCES customers(id) ON DELETE CASCADE, job_id text UNIQUE REFERENCES growth_jobs(id) ON DELETE SET NULL,
 amount integer NOT NULL, reason text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
