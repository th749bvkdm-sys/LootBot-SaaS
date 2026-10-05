CREATE TABLE IF NOT EXISTS store_members (
  id text PRIMARY KEY,
  store_id text NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invited_by text NOT NULL REFERENCES users(id),
  permissions jsonb NOT NULL DEFAULT '[]'::jsonb,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS store_members_store_user_unique ON store_members(store_id, user_id);
CREATE INDEX IF NOT EXISTS store_members_user_enabled_idx ON store_members(user_id, enabled);
