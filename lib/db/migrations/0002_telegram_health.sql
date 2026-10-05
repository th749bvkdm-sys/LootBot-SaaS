ALTER TABLE telegram_bots ADD COLUMN IF NOT EXISTS last_successful_poll_at timestamptz;
ALTER TABLE telegram_bots ADD COLUMN IF NOT EXISTS last_connection_test_at timestamptz;
ALTER TABLE telegram_bots ADD COLUMN IF NOT EXISTS last_connection_test_error text;
