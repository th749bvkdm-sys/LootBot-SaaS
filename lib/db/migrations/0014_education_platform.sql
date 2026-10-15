-- Additive schools, account enrollment and aptitude platform.
CREATE TABLE IF NOT EXISTS "education_announcements" (
	"id" text PRIMARY KEY NOT NULL,
	"class_id" text NOT NULL,
	"author_id" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "education_answers" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"question_id" text NOT NULL,
	"user_id" text NOT NULL,
	"category_id" text NOT NULL,
	"selected" integer NOT NULL,
	"correct" boolean NOT NULL,
	"seconds" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "education_answers_session_id_question_id_unique" UNIQUE("session_id","question_id")
);

CREATE TABLE IF NOT EXISTS "education_assignments" (
	"id" text PRIMARY KEY NOT NULL,
	"class_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"title" text NOT NULL,
	"question_ids" jsonb NOT NULL,
	"starts_at" timestamp with time zone DEFAULT now() NOT NULL,
	"due_at" timestamp with time zone,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "education_categories" (
	"id" text PRIMARY KEY NOT NULL,
	"parent_id" text,
	"name" text NOT NULL,
	"track" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"icon" text DEFAULT 'book' NOT NULL,
	"school_id" text,
	"stage" text DEFAULT '' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"visible" boolean DEFAULT true NOT NULL,
	"archived" boolean DEFAULT false NOT NULL
);

CREATE TABLE IF NOT EXISTS "education_code_uses" (
	"id" text PRIMARY KEY NOT NULL,
	"code_id" text NOT NULL,
	"user_id" text NOT NULL,
	"enrollment_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "education_code_uses_code_id_user_id_unique" UNIQUE("code_id","user_id")
);

CREATE TABLE IF NOT EXISTS "education_enrollments" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"school_id" text NOT NULL,
	"class_id" text NOT NULL,
	"roster_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "education_enrollments_user_id_class_id_unique" UNIQUE("user_id","class_id"),
	CONSTRAINT "education_enrollments_roster_id_unique" UNIQUE("roster_id")
);

CREATE TABLE IF NOT EXISTS "education_grants" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"scope" text DEFAULT '' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "education_grants_user_id_role_scope_unique" UNIQUE("user_id","role","scope")
);

CREATE TABLE IF NOT EXISTS "education_help" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"owner_id" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"role" text DEFAULT 'all' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"response" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "education_join_codes" (
	"id" text PRIMARY KEY NOT NULL,
	"school_id" text NOT NULL,
	"class_id" text NOT NULL,
	"created_by" text NOT NULL,
	"code_hash" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"max_uses" integer NOT NULL,
	"used_count" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"approval" boolean DEFAULT false NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "education_join_codes_code_hash_unique" UNIQUE("code_hash")
);

CREATE TABLE IF NOT EXISTS "education_personal" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"author_id" text NOT NULL,
	"kind" text NOT NULL,
	"question_id" text,
	"data" jsonb NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "education_practice_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"assignment_id" text,
	"mode" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"time_limit" integer,
	"active_seconds" integer DEFAULT 0 NOT NULL,
	"resumed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);

CREATE TABLE IF NOT EXISTS "education_question_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"question_id" text NOT NULL,
	"number" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "education_question_versions_question_id_number_unique" UNIQUE("question_id","number")
);

CREATE TABLE IF NOT EXISTS "education_questions" (
	"id" text PRIMARY KEY NOT NULL,
	"category_id" text NOT NULL,
	"text" text NOT NULL,
	"fingerprint" text NOT NULL,
	"difficulty" text NOT NULL,
	"content" jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"author_id" text NOT NULL,
	"reviewed_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "education_questions_fingerprint_unique" UNIQUE("fingerprint")
);

CREATE TABLE IF NOT EXISTS "education_roles" (
	"role" text PRIMARY KEY NOT NULL,
	"permissions" jsonb DEFAULT '[]'::jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS "education_school_classes" (
	"class_id" text PRIMARY KEY NOT NULL,
	"school_id" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "education_schools" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "education_settings" (
	"scope" text PRIMARY KEY DEFAULT '' NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_account_type_check";
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "suspended" boolean DEFAULT false NOT NULL;
DO $migration$ BEGIN ALTER TABLE "education_announcements" ADD CONSTRAINT "education_announcements_class_id_teacher_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "teacher_classes"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $migration$;
DO $migration$ BEGIN ALTER TABLE "education_announcements" ADD CONSTRAINT "education_announcements_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $migration$;
DO $migration$ BEGIN ALTER TABLE "education_answers" ADD CONSTRAINT "education_answers_session_id_education_practice_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "education_practice_sessions"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $migration$;
DO $migration$ BEGIN ALTER TABLE "education_answers" ADD CONSTRAINT "education_answers_question_id_education_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "education_questions"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $migration$;
DO $migration$ BEGIN ALTER TABLE "education_answers" ADD CONSTRAINT "education_answers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $migration$;
DO $migration$ BEGIN ALTER TABLE "education_answers" ADD CONSTRAINT "education_answers_category_id_education_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "education_categories"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $migration$;
DO $migration$ BEGIN ALTER TABLE "education_assignments" ADD CONSTRAINT "education_assignments_class_id_teacher_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "teacher_classes"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $migration$;
DO $migration$ BEGIN ALTER TABLE "education_assignments" ADD CONSTRAINT "education_assignments_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $migration$;
DO $migration$ BEGIN ALTER TABLE "education_categories" ADD CONSTRAINT "education_categories_school_id_education_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "education_schools"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $migration$;
DO $migration$ BEGIN ALTER TABLE "education_code_uses" ADD CONSTRAINT "education_code_uses_code_id_education_join_codes_id_fk" FOREIGN KEY ("code_id") REFERENCES "education_join_codes"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $migration$;
DO $migration$ BEGIN ALTER TABLE "education_code_uses" ADD CONSTRAINT "education_code_uses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $migration$;
DO $migration$ BEGIN ALTER TABLE "education_code_uses" ADD CONSTRAINT "education_code_uses_enrollment_id_education_enrollments_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "education_enrollments"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $migration$;
DO $migration$ BEGIN ALTER TABLE "education_enrollments" ADD CONSTRAINT "education_enrollments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $migration$;
DO $migration$ BEGIN ALTER TABLE "education_enrollments" ADD CONSTRAINT "education_enrollments_school_id_education_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "education_schools"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $migration$;
DO $migration$ BEGIN ALTER TABLE "education_enrollments" ADD CONSTRAINT "education_enrollments_class_id_teacher_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "teacher_classes"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $migration$;
DO $migration$ BEGIN ALTER TABLE "education_enrollments" ADD CONSTRAINT "education_enrollments_roster_id_teacher_students_id_fk" FOREIGN KEY ("roster_id") REFERENCES "teacher_students"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $migration$;
DO $migration$ BEGIN ALTER TABLE "education_grants" ADD CONSTRAINT "education_grants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $migration$;
DO $migration$ BEGIN ALTER TABLE "education_grants" ADD CONSTRAINT "education_grants_role_education_roles_role_fk" FOREIGN KEY ("role") REFERENCES "education_roles"("role") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $migration$;
DO $migration$ BEGIN ALTER TABLE "education_help" ADD CONSTRAINT "education_help_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $migration$;
DO $migration$ BEGIN ALTER TABLE "education_join_codes" ADD CONSTRAINT "education_join_codes_school_id_education_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "education_schools"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $migration$;
DO $migration$ BEGIN ALTER TABLE "education_join_codes" ADD CONSTRAINT "education_join_codes_class_id_teacher_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "teacher_classes"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $migration$;
DO $migration$ BEGIN ALTER TABLE "education_join_codes" ADD CONSTRAINT "education_join_codes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $migration$;
DO $migration$ BEGIN ALTER TABLE "education_personal" ADD CONSTRAINT "education_personal_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $migration$;
DO $migration$ BEGIN ALTER TABLE "education_personal" ADD CONSTRAINT "education_personal_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $migration$;
DO $migration$ BEGIN ALTER TABLE "education_personal" ADD CONSTRAINT "education_personal_question_id_education_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "education_questions"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $migration$;
DO $migration$ BEGIN ALTER TABLE "education_practice_sessions" ADD CONSTRAINT "education_practice_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $migration$;
DO $migration$ BEGIN ALTER TABLE "education_practice_sessions" ADD CONSTRAINT "education_practice_sessions_assignment_id_education_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "education_assignments"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $migration$;
DO $migration$ BEGIN ALTER TABLE "education_question_versions" ADD CONSTRAINT "education_question_versions_question_id_education_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "education_questions"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $migration$;
DO $migration$ BEGIN ALTER TABLE "education_questions" ADD CONSTRAINT "education_questions_category_id_education_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "education_categories"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $migration$;
DO $migration$ BEGIN ALTER TABLE "education_questions" ADD CONSTRAINT "education_questions_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $migration$;
DO $migration$ BEGIN ALTER TABLE "education_questions" ADD CONSTRAINT "education_questions_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $migration$;
DO $migration$ BEGIN ALTER TABLE "education_school_classes" ADD CONSTRAINT "education_school_classes_class_id_teacher_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "teacher_classes"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $migration$;
DO $migration$ BEGIN ALTER TABLE "education_school_classes" ADD CONSTRAINT "education_school_classes_school_id_education_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "education_schools"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $migration$;
CREATE INDEX IF NOT EXISTS "education_answers_user_idx" ON "education_answers" USING btree ("user_id","category_id");
CREATE INDEX IF NOT EXISTS "education_enrollment_user_idx" ON "education_enrollments" USING btree ("user_id","status");
CREATE INDEX IF NOT EXISTS "education_grants_user_idx" ON "education_grants" USING btree ("user_id","scope");
CREATE INDEX IF NOT EXISTS "education_codes_school_idx" ON "education_join_codes" USING btree ("school_id");
CREATE INDEX IF NOT EXISTS "education_personal_user_idx" ON "education_personal" USING btree ("user_id","kind");
CREATE INDEX IF NOT EXISTS "education_sessions_user_idx" ON "education_practice_sessions" USING btree ("user_id","created_at");
DO $migration$ BEGIN ALTER TABLE "users" ADD CONSTRAINT "users_account_type_check" CHECK ("users"."account_type" IS NULL OR "users"."account_type" IN ('merchant','teacher','student')); EXCEPTION WHEN duplicate_object THEN NULL; END $migration$;
ALTER TABLE education_categories ADD COLUMN IF NOT EXISTS link text NOT NULL DEFAULT '';
ALTER TABLE education_categories ADD COLUMN IF NOT EXISTS class_id text REFERENCES teacher_classes(id);
ALTER TABLE education_assignments ADD COLUMN IF NOT EXISTS snapshot jsonb NOT NULL DEFAULT '[]';
ALTER TABLE education_assignments ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'training';
ALTER TABLE education_assignments ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'learn';
ALTER TABLE education_assignments ADD COLUMN IF NOT EXISTS time_limit integer;
UPDATE education_assignments a SET snapshot=coalesce((SELECT jsonb_agg(to_jsonb(q)) FROM education_questions q WHERE a.question_ids ? q.id),'[]') WHERE snapshot='[]';
DO $migration$ BEGIN ALTER TABLE education_categories ADD CONSTRAINT education_category_parent_fk FOREIGN KEY(parent_id) REFERENCES education_categories(id); EXCEPTION WHEN duplicate_object THEN NULL; END $migration$;
DO $migration$ BEGIN ALTER TABLE education_join_codes ADD CONSTRAINT education_codes_limits_check CHECK(max_uses BETWEEN 1 AND 5000 AND used_count BETWEEN 0 AND max_uses AND status IN ('active','paused','revoked')); EXCEPTION WHEN duplicate_object THEN NULL; END $migration$;
DO $migration$ BEGIN ALTER TABLE education_enrollments ADD CONSTRAINT education_enrollment_status_check CHECK(status IN ('pending','active','revoked')); EXCEPTION WHEN duplicate_object THEN NULL; END $migration$;
INSERT INTO education_roles(role,permissions) VALUES
('SCHOOL_ADMIN','["schools.read","schools.edit","codes.write","classes.write","enrollments.write","reports.read","audit.read","announcements.write"]'),
('TEACHER','["classes.read","classes.write","reports.read","announcements.write","assignments.write","plans.write"]'),
('STUDENT','["practice.read","practice.write","personal.write","help.write"]'),
('CONTENT_MANAGER','["categories.write","questions.write","questions.publish","faq.write"]'),
('SUPPORT','["schools.read","reports.read","audit.read","help.read","help.write"]') ON CONFLICT(role) DO NOTHING;
INSERT INTO education_categories(id,name,track,position) SELECT '9d9b0d96-cf1b-4c58-98df-26b6124d3137','استيعاب المقروء','verbal',1 WHERE NOT EXISTS(SELECT 1 FROM education_categories WHERE name='استيعاب المقروء' AND track='verbal');
INSERT INTO education_categories(id,name,track,position) SELECT 'af2a211b-92c5-4bbd-ba48-fa95ccd8738b','التناظر اللفظي','verbal',2 WHERE NOT EXISTS(SELECT 1 FROM education_categories WHERE name='التناظر اللفظي' AND track='verbal');
INSERT INTO education_categories(id,name,track,position) SELECT 'd512726a-f240-4b10-a2be-9119ca04512b','إكمال الجمل','verbal',3 WHERE NOT EXISTS(SELECT 1 FROM education_categories WHERE name='إكمال الجمل' AND track='verbal');
INSERT INTO education_categories(id,name,track,position) SELECT 'e043550a-baae-4acf-8a97-7ddb18cd1ce8','الخطأ السياقي','verbal',4 WHERE NOT EXISTS(SELECT 1 FROM education_categories WHERE name='الخطأ السياقي' AND track='verbal');
INSERT INTO education_categories(id,name,track,position) SELECT '600581b8-d349-42b6-98f3-5a5213567efe','الارتباط والاختلاف بين الكلمات','verbal',5 WHERE NOT EXISTS(SELECT 1 FROM education_categories WHERE name='الارتباط والاختلاف بين الكلمات' AND track='verbal');
INSERT INTO education_categories(id,name,track,position) SELECT '6006a809-bc2f-473b-bfea-ee4513f70b02','استنتاج الفكرة الرئيسية','verbal',6 WHERE NOT EXISTS(SELECT 1 FROM education_categories WHERE name='استنتاج الفكرة الرئيسية' AND track='verbal');
INSERT INTO education_categories(id,name,track,position) SELECT 'a3e933bc-ccd0-45b4-8908-56c1b8f3c3dd','السبب والنتيجة','verbal',7 WHERE NOT EXISTS(SELECT 1 FROM education_categories WHERE name='السبب والنتيجة' AND track='verbal');
INSERT INTO education_categories(id,name,track,position) SELECT '38b073c4-5e68-457f-8a6c-e9fefc142fab','مرجع الضمير','verbal',8 WHERE NOT EXISTS(SELECT 1 FROM education_categories WHERE name='مرجع الضمير' AND track='verbal');
INSERT INTO education_categories(id,name,track,position) SELECT 'fb6b952c-2e64-4541-b32a-ed2f2c3963bd','العلاقات بين الأفكار','verbal',9 WHERE NOT EXISTS(SELECT 1 FROM education_categories WHERE name='العلاقات بين الأفكار' AND track='verbal');
INSERT INTO education_categories(id,name,track,position) SELECT '647dbc3a-3fbe-4a56-afb3-7919d6d15728','معنى الكلمة من السياق','verbal',10 WHERE NOT EXISTS(SELECT 1 FROM education_categories WHERE name='معنى الكلمة من السياق' AND track='verbal');
INSERT INTO education_categories(id,name,track,position) SELECT '43e75885-9aaf-4d25-bb7d-2309eeefb0a5','الحساب والعمليات الأساسية','quantitative',1 WHERE NOT EXISTS(SELECT 1 FROM education_categories WHERE name='الحساب والعمليات الأساسية' AND track='quantitative');
INSERT INTO education_categories(id,name,track,position) SELECT 'a8a1c99a-cbe9-4a39-a7cb-ac652faab756','النسب والتناسب','quantitative',2 WHERE NOT EXISTS(SELECT 1 FROM education_categories WHERE name='النسب والتناسب' AND track='quantitative');
INSERT INTO education_categories(id,name,track,position) SELECT '49248604-0408-4bc0-9c74-214e80aa6814','النسبة المئوية','quantitative',3 WHERE NOT EXISTS(SELECT 1 FROM education_categories WHERE name='النسبة المئوية' AND track='quantitative');
INSERT INTO education_categories(id,name,track,position) SELECT '6dc0ee21-211b-43ae-8d3c-55202c8e3863','الكسور والأعداد العشرية','quantitative',4 WHERE NOT EXISTS(SELECT 1 FROM education_categories WHERE name='الكسور والأعداد العشرية' AND track='quantitative');
INSERT INTO education_categories(id,name,track,position) SELECT '66168311-82ed-40d3-94e6-b6fcca7f7477','المتوسطات','quantitative',5 WHERE NOT EXISTS(SELECT 1 FROM education_categories WHERE name='المتوسطات' AND track='quantitative');
INSERT INTO education_categories(id,name,track,position) SELECT 'fdf12c78-068a-42a0-97ab-4dfb74e60e28','المعادلات','quantitative',6 WHERE NOT EXISTS(SELECT 1 FROM education_categories WHERE name='المعادلات' AND track='quantitative');
INSERT INTO education_categories(id,name,track,position) SELECT '9679b7e9-1283-4c6e-9532-fee07397b576','الهندسة والقياس','quantitative',7 WHERE NOT EXISTS(SELECT 1 FROM education_categories WHERE name='الهندسة والقياس' AND track='quantitative');
INSERT INTO education_categories(id,name,track,position) SELECT '1e49ac29-b11f-469d-ad9e-47e36d8c65cf','الجبر','quantitative',8 WHERE NOT EXISTS(SELECT 1 FROM education_categories WHERE name='الجبر' AND track='quantitative');
INSERT INTO education_categories(id,name,track,position) SELECT '3a92921d-ae5d-4b94-abd5-b4c55b3d8fd1','الإحصاء والاحتمالات','quantitative',9 WHERE NOT EXISTS(SELECT 1 FROM education_categories WHERE name='الإحصاء والاحتمالات' AND track='quantitative');
INSERT INTO education_categories(id,name,track,position) SELECT 'ab229490-bd35-449a-ad2c-9bb764604d13','المسائل اللفظية الكمية','quantitative',10 WHERE NOT EXISTS(SELECT 1 FROM education_categories WHERE name='المسائل اللفظية الكمية' AND track='quantitative');
INSERT INTO education_categories(id,name,track,position) SELECT '50d3a493-570e-420b-a82f-42e846d79cac','السرعة والزمن والعمل','quantitative',11 WHERE NOT EXISTS(SELECT 1 FROM education_categories WHERE name='السرعة والزمن والعمل' AND track='quantitative');
INSERT INTO education_categories(id,name,track,position) SELECT '18622197-9fff-492d-9613-d641d433874c','المقارنة بين الكميات','quantitative',12 WHERE NOT EXISTS(SELECT 1 FROM education_categories WHERE name='المقارنة بين الكميات' AND track='quantitative');
INSERT INTO education_categories(id,name,track,position) SELECT '4fc31c2e-919f-4012-9f01-0ff0ee2760dc','الاستدلال الرياضي','quantitative',13 WHERE NOT EXISTS(SELECT 1 FROM education_categories WHERE name='الاستدلال الرياضي' AND track='quantitative');
