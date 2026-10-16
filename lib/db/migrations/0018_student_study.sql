-- Private student study tools. No public profiles, contact details or global ranking.
CREATE TABLE IF NOT EXISTS student_study_preferences (
 user_id text PRIMARY KEY REFERENCES users(id), daily_goal_minutes integer NOT NULL DEFAULT 25 CHECK(daily_goal_minutes BETWEEN 5 AND 240),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS student_study_tasks (
 id text PRIMARY KEY,user_id text NOT NULL REFERENCES users(id),title text NOT NULL CHECK(length(title) BETWEEN 1 AND 160),due_date date,
 done boolean NOT NULL DEFAULT false,completed_at timestamptz,removed boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS student_study_tasks_user_idx ON student_study_tasks(user_id,removed,created_at);
CREATE TABLE IF NOT EXISTS student_focus_sessions (
 id text PRIMARY KEY,user_id text NOT NULL REFERENCES users(id),request_id text NOT NULL,planned_minutes integer NOT NULL CHECK(planned_minutes BETWEEN 1 AND 120),
 started_at timestamptz NOT NULL DEFAULT now(),ends_at timestamptz NOT NULL,status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','completed','cancelled')),completed_at timestamptz,
 UNIQUE(user_id,request_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS student_focus_active_idx ON student_focus_sessions(user_id) WHERE status='active';
CREATE INDEX IF NOT EXISTS student_focus_history_idx ON student_focus_sessions(user_id,completed_at);
CREATE TABLE IF NOT EXISTS student_study_rooms (
 id text PRIMARY KEY,school_id text NOT NULL REFERENCES education_schools(id),host_user_id text NOT NULL REFERENCES users(id),title text NOT NULL CHECK(length(title) BETWEEN 1 AND 80),
 code_hash text NOT NULL UNIQUE,capacity integer NOT NULL DEFAULT 6 CHECK(capacity BETWEEN 2 AND 12),created_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL DEFAULT now()+interval '8 hours',
 closed boolean NOT NULL DEFAULT false,focus_started_at timestamptz,focus_ends_at timestamptz,focus_minutes integer CHECK(focus_minutes BETWEEN 1 AND 120)
);
CREATE INDEX IF NOT EXISTS student_study_rooms_school_idx ON student_study_rooms(school_id,expires_at);
CREATE TABLE IF NOT EXISTS student_study_members (
 room_id text NOT NULL REFERENCES student_study_rooms(id),user_id text NOT NULL REFERENCES users(id),nickname text NOT NULL CHECK(length(nickname) BETWEEN 2 AND 24),
 joined_at timestamptz NOT NULL DEFAULT now(),last_seen_at timestamptz NOT NULL DEFAULT now(),left_at timestamptz,PRIMARY KEY(room_id,user_id)
);
CREATE INDEX IF NOT EXISTS student_study_members_user_idx ON student_study_members(user_id,last_seen_at);
CREATE TABLE IF NOT EXISTS student_room_challenges (
 id text PRIMARY KEY,room_id text NOT NULL REFERENCES student_study_rooms(id),track_id text NOT NULL,snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='array'),
 started_at timestamptz NOT NULL DEFAULT now(),deadline_at timestamptz NOT NULL,created_by text NOT NULL REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS student_room_challenges_room_idx ON student_room_challenges(room_id,started_at);
CREATE TABLE IF NOT EXISTS student_room_challenge_entries (
 challenge_id text NOT NULL REFERENCES student_room_challenges(id),user_id text NOT NULL REFERENCES users(id),nickname text NOT NULL,
 answers jsonb NOT NULL DEFAULT '{}',submitted_at timestamptz,score integer CHECK(score>=0),PRIMARY KEY(challenge_id,user_id),CHECK(jsonb_typeof(answers)='object')
);
