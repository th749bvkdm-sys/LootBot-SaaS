-- Quantitative exams reuse education_question_versions; no second question bank.
CREATE TABLE IF NOT EXISTS quant_sources (
 id text PRIMARY KEY,title text NOT NULL,file_name text NOT NULL DEFAULT '',file_hash text NOT NULL UNIQUE,
 file_size bigint NOT NULL DEFAULT 0 CHECK(file_size>=0),source_url text NOT NULL DEFAULT '',page_count integer CHECK(page_count>0),
 license_status text NOT NULL DEFAULT 'unverified' CHECK(license_status IN ('unverified','verified','restricted','rejected')),
 license_note text NOT NULL DEFAULT '',attribution text NOT NULL DEFAULT '',private_path text NOT NULL DEFAULT '',
 created_by text NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(license_status<>'verified' OR length(trim(license_note))>0)
);
CREATE TABLE IF NOT EXISTS quant_question_reviews (
 version_id text PRIMARY KEY REFERENCES education_question_versions(id),question_id text NOT NULL REFERENCES education_questions(id),
 source_id text REFERENCES quant_sources(id),source_page integer CHECK(source_page>0),
 review_status text NOT NULL DEFAULT 'draft' CHECK(review_status IN ('draft','extracted','needs_review','reviewed','approved','rejected')),
 normalized_hash text NOT NULL,skill text NOT NULL,review_note text NOT NULL DEFAULT '',reviewed_by text REFERENCES users(id),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS quant_reviews_question_idx ON quant_question_reviews(question_id);
CREATE INDEX IF NOT EXISTS quant_reviews_source_idx ON quant_question_reviews(source_id);
CREATE INDEX IF NOT EXISTS quant_reviews_skill_idx ON quant_question_reviews(skill);
CREATE INDEX IF NOT EXISTS quant_reviews_hash_idx ON quant_question_reviews(normalized_hash);
CREATE TABLE IF NOT EXISTS quant_question_sources (
 id text PRIMARY KEY,question_id text NOT NULL REFERENCES education_questions(id),source_id text NOT NULL REFERENCES quant_sources(id),
 source_page integer NOT NULL CHECK(source_page>0),CONSTRAINT quant_question_source_page_unique UNIQUE(question_id,source_id,source_page)
);
CREATE TABLE IF NOT EXISTS quant_extraction_pages (
 source_id text NOT NULL REFERENCES quant_sources(id),page integer NOT NULL CHECK(page>0),
 status text NOT NULL CHECK(status IN ('done','skipped','needs_review','failed')),text_excerpt text NOT NULL DEFAULT '',reason text NOT NULL DEFAULT '',
 question_id text REFERENCES education_questions(id),processed_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(source_id,page)
);
CREATE TABLE IF NOT EXISTS quant_extraction_jobs (
 id text PRIMARY KEY,source_id text NOT NULL REFERENCES quant_sources(id),status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','completed','failed')),
 started_at timestamptz,finished_at timestamptz,error text NOT NULL DEFAULT '',created_by text NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS quant_extraction_source_idx ON quant_extraction_jobs(source_id);
CREATE TABLE IF NOT EXISTS quant_tests (
 id text PRIMARY KEY,title text NOT NULL,description text NOT NULL DEFAULT '',mode text NOT NULL CHECK(mode IN ('timed','untimed','practice','simulation')),
 time_limit_sec integer CHECK(time_limit_sec BETWEEN 60 AND 14400),allow_return boolean NOT NULL DEFAULT true,
 reveal_policy text NOT NULL DEFAULT 'after_submit' CHECK(reveal_policy IN ('never','after_submit','after_each','after_deadline')),reveal_at timestamptz,
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','hidden')),school_id text REFERENCES education_schools(id),
 class_id text REFERENCES teacher_classes(id),stage text NOT NULL DEFAULT '',created_by text NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(mode NOT IN ('timed','simulation') OR time_limit_sec IS NOT NULL),CHECK(reveal_policy<>'after_deadline' OR reveal_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS quant_tests_scope_idx ON quant_tests(status,school_id,class_id);
CREATE TABLE IF NOT EXISTS quant_test_items (
 test_id text NOT NULL REFERENCES quant_tests(id) ON DELETE CASCADE,version_id text NOT NULL REFERENCES education_question_versions(id),
 position integer NOT NULL CHECK(position>=0),PRIMARY KEY(test_id,position),CONSTRAINT quant_test_version_unique UNIQUE(test_id,version_id)
);
CREATE TABLE IF NOT EXISTS quant_attempts (
 id text PRIMARY KEY,test_id text REFERENCES quant_tests(id),user_id text NOT NULL REFERENCES users(id),
 enrollment_id text NOT NULL REFERENCES education_enrollments(id),school_id text NOT NULL REFERENCES education_schools(id),class_id text REFERENCES teacher_classes(id),
 test_snapshot jsonb NOT NULL,snapshot jsonb NOT NULL,started_at timestamptz NOT NULL DEFAULT now(),deadline_at timestamptz,submitted_at timestamptz,
 status text NOT NULL DEFAULT 'in_progress' CHECK(status IN ('in_progress','submitted','expired')),
 current_index integer NOT NULL DEFAULT 0 CHECK(current_index>=0),checkpoint_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS quant_attempt_user_idx ON quant_attempts(user_id,started_at);
CREATE INDEX IF NOT EXISTS quant_attempt_test_idx ON quant_attempts(test_id);
CREATE INDEX IF NOT EXISTS quant_attempt_deadline_idx ON quant_attempts(status,deadline_at);
CREATE TABLE IF NOT EXISTS quant_responses (
 attempt_id text NOT NULL REFERENCES quant_attempts(id) ON DELETE CASCADE,version_id text NOT NULL REFERENCES education_question_versions(id),choice_key text,
 flagged boolean NOT NULL DEFAULT false,visited boolean NOT NULL DEFAULT false,revision integer NOT NULL DEFAULT 0 CHECK(revision>=0),
 change_count integer NOT NULL DEFAULT 0 CHECK(change_count>=0),time_spent_ms bigint NOT NULL DEFAULT 0 CHECK(time_spent_ms>=0),
 updated_at timestamptz NOT NULL DEFAULT now(),first_answered_at timestamptz,PRIMARY KEY(attempt_id,version_id)
);
CREATE TABLE IF NOT EXISTS quant_scratchpads (
 attempt_id text NOT NULL REFERENCES quant_attempts(id) ON DELETE CASCADE,version_id text NOT NULL REFERENCES education_question_versions(id),
 strokes jsonb NOT NULL DEFAULT '[]',revision integer NOT NULL DEFAULT 0 CHECK(revision>=0),updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(attempt_id,version_id),CHECK(jsonb_typeof(strokes)='array')
);
