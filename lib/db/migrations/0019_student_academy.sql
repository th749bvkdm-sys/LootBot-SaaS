-- Original LootBot foundation training is separate from licensed publisher banks.
CREATE TABLE IF NOT EXISTS student_academy_attempts (
 id text PRIMARY KEY,
 user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 track_id text NOT NULL,
 lesson_id text,
 mode text NOT NULL CHECK(mode IN ('untimed','timed','simulation')),
 title text NOT NULL,
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','submitted','expired')),
 snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='array'),
 answers jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(answers)='object'),
 result jsonb,
 revision integer NOT NULL DEFAULT 0 CHECK(revision>=0),
 started_at timestamptz NOT NULL DEFAULT now(),
 deadline_at timestamptz,
 finished_at timestamptz,
 CHECK(deadline_at IS NULL OR deadline_at>started_at),
 CHECK((status='active' AND finished_at IS NULL AND result IS NULL) OR (status<>'active' AND finished_at IS NOT NULL AND result IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS student_academy_attempts_owner_idx ON student_academy_attempts(user_id,started_at DESC);
CREATE TABLE IF NOT EXISTS student_academy_progress (
 user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 lesson_id text NOT NULL,
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0),
 best_score integer NOT NULL DEFAULT 0 CHECK(best_score BETWEEN 0 AND 100),
 completed_at timestamptz,
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,lesson_id)
);
CREATE TABLE IF NOT EXISTS student_academy_mistakes (
 user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 question_id text NOT NULL,
 track_id text NOT NULL,
 lesson_id text NOT NULL,
 snapshot jsonb NOT NULL,
 wrong_count integer NOT NULL DEFAULT 1 CHECK(wrong_count>0),
 last_attempt_at timestamptz NOT NULL DEFAULT now(),
 mastered boolean NOT NULL DEFAULT false,
 PRIMARY KEY(user_id,question_id)
);
CREATE INDEX IF NOT EXISTS student_academy_mistakes_owner_idx ON student_academy_mistakes(user_id,last_attempt_at DESC);
