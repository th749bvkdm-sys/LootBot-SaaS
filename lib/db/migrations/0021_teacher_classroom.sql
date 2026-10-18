-- Classroom rewards are private, append-only, owner-scoped and idempotent.
CREATE TABLE IF NOT EXISTS teacher_classroom_events (
 id text PRIMARY KEY,
 owner_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 class_id text NOT NULL,
 student_ids jsonb NOT NULL DEFAULT '[]',
 points integer NOT NULL CHECK(points BETWEEN 1 AND 1000),
 reason text NOT NULL CHECK(char_length(reason) BETWEEN 1 AND 200),
 day date NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(class_id,owner_id) REFERENCES teacher_classes(id,owner_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS teacher_classroom_events_class_idx ON teacher_classroom_events(owner_id,class_id,day);
CREATE TABLE IF NOT EXISTS teacher_classroom_days (
 owner_id text NOT NULL,
 class_id text NOT NULL,
 day date NOT NULL,
 PRIMARY KEY(owner_id,class_id,day),
 FOREIGN KEY(class_id,owner_id) REFERENCES teacher_classes(id,owner_id) ON DELETE CASCADE
);
