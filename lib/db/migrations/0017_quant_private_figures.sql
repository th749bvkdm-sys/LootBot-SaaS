-- Private figure crops are bound to immutable versions; original PDF pages stay private.
CREATE TABLE IF NOT EXISTS quant_question_figures (
 id text PRIMARY KEY,
 version_id text NOT NULL REFERENCES education_question_versions(id),
 source_id text NOT NULL REFERENCES quant_sources(id),
 source_page integer NOT NULL CHECK(source_page>0),
 position integer NOT NULL CHECK(position>=0 AND position<8),
 file_hash text NOT NULL CHECK(file_hash ~ '^[0-9a-f]{64}$'),
 relative_path text NOT NULL,
 width integer NOT NULL CHECK(width BETWEEN 16 AND 4000),
 height integer NOT NULL CHECK(height BETWEEN 16 AND 4000),
 review_note text NOT NULL CHECK(length(trim(review_note))>=20),
 created_by text NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT quant_figure_version_position_unique UNIQUE(version_id,position)
);
CREATE INDEX IF NOT EXISTS quant_figure_source_idx ON quant_question_figures(source_id);
