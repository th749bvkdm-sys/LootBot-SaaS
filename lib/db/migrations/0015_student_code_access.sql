-- Personal student credentials: never reuse a shared classroom join code as a login.
ALTER TABLE users ADD COLUMN IF NOT EXISTS student_code_managed boolean NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS education_student_access (
  id text PRIMARY KEY,
  enrollment_id text NOT NULL REFERENCES education_enrollments(id),
  code_hash text NOT NULL UNIQUE,
  created_by text NOT NULL REFERENCES users(id),
  expires_at timestamptz NOT NULL,
  revoked boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);
CREATE INDEX IF NOT EXISTS education_student_access_enrollment_idx ON education_student_access(enrollment_id);
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS student_access_id text;
DO $$ BEGIN
  ALTER TABLE sessions ADD CONSTRAINT sessions_student_access_fk FOREIGN KEY (student_access_id) REFERENCES education_student_access(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS sessions_student_access_idx ON sessions(student_access_id);
