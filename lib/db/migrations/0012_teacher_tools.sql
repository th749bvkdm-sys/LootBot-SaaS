-- Reuse the private teacher_records model for documents, rubrics and planning.
ALTER TABLE teacher_records DROP CONSTRAINT IF EXISTS teacher_records_kind_check;
ALTER TABLE teacher_records ADD CONSTRAINT teacher_records_kind_check CHECK(kind IN ('attendance','grades','tasks','lessons','questions','assessments','blueprints','rubrics','feedback','documents','resources','calendar'));
ALTER TABLE teacher_records ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 1;
CREATE TABLE IF NOT EXISTS teacher_roster_snapshots(id text PRIMARY KEY,owner_id text NOT NULL,class_id text NOT NULL,term text NOT NULL,students jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),FOREIGN KEY(class_id,owner_id) REFERENCES teacher_classes(id,owner_id));
CREATE INDEX IF NOT EXISTS teacher_roster_snapshots_class_idx ON teacher_roster_snapshots(owner_id,class_id);
CREATE TABLE IF NOT EXISTS teacher_template_shares(id text PRIMARY KEY,owner_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,token_hash text NOT NULL UNIQUE,content jsonb NOT NULL,enabled boolean NOT NULL DEFAULT true,created_at timestamptz NOT NULL DEFAULT now());
