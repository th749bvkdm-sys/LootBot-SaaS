-- Reviewed question images remain private and survive ephemeral service deploys.
-- Content is addressed by SHA256; serving still requires the existing source,
-- version, review and attempt authorization checks.
CREATE TABLE IF NOT EXISTS quant_figure_blobs (
 file_hash text PRIMARY KEY CHECK(file_hash ~ '^[0-9a-f]{64}$'),
 png_data bytea NOT NULL CHECK(octet_length(png_data) BETWEEN 33 AND 12582912),
 width integer NOT NULL CHECK(width BETWEEN 16 AND 4000),
 height integer NOT NULL CHECK(height BETWEEN 16 AND 4000),
 created_at timestamptz NOT NULL DEFAULT now()
);
