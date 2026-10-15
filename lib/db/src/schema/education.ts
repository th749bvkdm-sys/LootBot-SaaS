import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { usersTable } from "./auth";
import { teacherClassesTable, teacherStudentsTable } from "./teacher";
const created = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updated = () =>
  timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();
const user = (name: string) =>
  text(name)
    .notNull()
    .references(() => usersTable.id);
export const educationStudentAccessTable = pgTable("education_student_access", {
  id: text("id").primaryKey(),
  enrollmentId: text("enrollment_id")
    .notNull()
    .references(() => educationEnrollmentsTable.id),
  codeHash: text("code_hash").notNull().unique(),
  createdBy: user("created_by"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revoked: boolean("revoked").notNull().default(false),
  createdAt: created(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
});
export const educationSchoolsTable = pgTable("education_schools", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  status: text("status").notNull().default("active"),
  data: jsonb("data").notNull().default({}),
  createdAt: created(),
  updatedAt: updated(),
});
export const educationRolesTable = pgTable("education_roles", {
  role: text("role").primaryKey(),
  permissions: jsonb("permissions").$type<string[]>().notNull().default([]),
});
export const educationGrantsTable = pgTable(
  "education_grants",
  {
    id: text("id").primaryKey(),
    userId: user("user_id"),
    role: text("role")
      .notNull()
      .references(() => educationRolesTable.role),
    scope: text("scope").notNull().default(""),
    active: boolean("active").notNull().default(true),
    createdAt: created(),
  },
  (t) => [
    unique().on(t.userId, t.role, t.scope),
    index("education_grants_user_idx").on(t.userId, t.scope),
  ],
);
export const educationSchoolClassesTable = pgTable("education_school_classes", {
  classId: text("class_id")
    .primaryKey()
    .references(() => teacherClassesTable.id),
  schoolId: text("school_id")
    .notNull()
    .references(() => educationSchoolsTable.id),
});
export const educationJoinCodesTable = pgTable(
  "education_join_codes",
  {
    id: text("id").primaryKey(),
    schoolId: text("school_id")
      .notNull()
      .references(() => educationSchoolsTable.id),
    classId: text("class_id")
      .notNull()
      .references(() => teacherClassesTable.id),
    createdBy: user("created_by"),
    codeHash: text("code_hash").notNull().unique(),
    status: text("status").notNull().default("active"),
    maxUses: integer("max_uses").notNull(),
    usedCount: integer("used_count").notNull().default(0),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    approval: boolean("approval").notNull().default(false),
    data: jsonb("data").notNull().default({}),
    createdAt: created(),
  },
  (t) => [index("education_codes_school_idx").on(t.schoolId)],
);
export const educationEnrollmentsTable = pgTable(
  "education_enrollments",
  {
    id: text("id").primaryKey(),
    userId: user("user_id"),
    schoolId: text("school_id")
      .notNull()
      .references(() => educationSchoolsTable.id),
    classId: text("class_id")
      .notNull()
      .references(() => teacherClassesTable.id),
    rosterId: text("roster_id")
      .notNull()
      .references(() => teacherStudentsTable.id),
    status: text("status").notNull().default("pending"),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [
    unique().on(t.userId, t.classId),
    unique().on(t.rosterId),
    index("education_enrollment_user_idx").on(t.userId, t.status),
  ],
);
export const educationCodeUsesTable = pgTable(
  "education_code_uses",
  {
    id: text("id").primaryKey(),
    codeId: text("code_id")
      .notNull()
      .references(() => educationJoinCodesTable.id),
    userId: user("user_id"),
    enrollmentId: text("enrollment_id")
      .notNull()
      .references(() => educationEnrollmentsTable.id),
    createdAt: created(),
  },
  (t) => [unique().on(t.codeId, t.userId)],
);
export const educationSettingsTable = pgTable("education_settings", {
  scope: text("scope").primaryKey().default(""),
  data: jsonb("data").notNull().default({}),
  updatedAt: updated(),
});
export const educationCategoriesTable = pgTable("education_categories", {
  id: text("id").primaryKey(),
  parentId: text("parent_id"),
  link: text("link").notNull().default(""),
  classId: text("class_id").references(() => teacherClassesTable.id),
  name: text("name").notNull(),
  track: text("track").notNull(),
  description: text("description").notNull().default(""),
  icon: text("icon").notNull().default("book"),
  schoolId: text("school_id").references(() => educationSchoolsTable.id),
  stage: text("stage").notNull().default(""),
  position: integer("position").notNull().default(0),
  visible: boolean("visible").notNull().default(true),
  archived: boolean("archived").notNull().default(false),
});
export const educationQuestionsTable = pgTable("education_questions", {
  id: text("id").primaryKey(),
  categoryId: text("category_id")
    .notNull()
    .references(() => educationCategoriesTable.id),
  text: text("text").notNull(),
  fingerprint: text("fingerprint").notNull().unique(),
  difficulty: text("difficulty").notNull(),
  content: jsonb("content").notNull(),
  status: text("status").notNull().default("draft"),
  revision: integer("revision").notNull().default(1),
  authorId: user("author_id"),
  reviewedBy: text("reviewed_by").references(() => usersTable.id),
  createdAt: created(),
  updatedAt: updated(),
});
export const educationQuestionVersionsTable = pgTable(
  "education_question_versions",
  {
    id: text("id").primaryKey(),
    questionId: text("question_id")
      .notNull()
      .references(() => educationQuestionsTable.id),
    number: integer("number").notNull(),
    snapshot: jsonb("snapshot").notNull(),
    createdAt: created(),
  },
  (t) => [unique().on(t.questionId, t.number)],
);
export const educationAssignmentsTable = pgTable("education_assignments", {
  id: text("id").primaryKey(),
  classId: text("class_id")
    .notNull()
    .references(() => teacherClassesTable.id),
  ownerId: user("owner_id"),
  title: text("title").notNull(),
  questionIds: jsonb("question_ids").$type<string[]>().notNull(),
  snapshot: jsonb("snapshot").notNull().default([]),
  kind: text("kind").notNull().default("training"),
  mode: text("mode").notNull().default("learn"),
  timeLimit: integer("time_limit"),
  startsAt: timestamp("starts_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  dueAt: timestamp("due_at", { withTimezone: true }),
  archived: boolean("archived").notNull().default(false),
  createdAt: created(),
});
export const educationPracticeSessionsTable = pgTable(
  "education_practice_sessions",
  {
    id: text("id").primaryKey(),
    userId: user("user_id"),
    assignmentId: text("assignment_id").references(
      () => educationAssignmentsTable.id,
    ),
    mode: text("mode").notNull(),
    snapshot: jsonb("snapshot").notNull(),
    status: text("status").notNull().default("active"),
    timeLimit: integer("time_limit"),
    activeSeconds: integer("active_seconds").notNull().default(0),
    resumedAt: timestamp("resumed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: created(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [index("education_sessions_user_idx").on(t.userId, t.createdAt)],
);
export const educationAnswersTable = pgTable(
  "education_answers",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => educationPracticeSessionsTable.id),
    questionId: text("question_id")
      .notNull()
      .references(() => educationQuestionsTable.id),
    userId: user("user_id"),
    categoryId: text("category_id")
      .notNull()
      .references(() => educationCategoriesTable.id),
    selected: integer("selected").notNull(),
    correct: boolean("correct").notNull(),
    seconds: integer("seconds").notNull(),
    createdAt: created(),
  },
  (t) => [
    unique().on(t.sessionId, t.questionId),
    index("education_answers_user_idx").on(t.userId, t.categoryId),
  ],
);
export const educationPersonalTable = pgTable(
  "education_personal",
  {
    id: text("id").primaryKey(),
    userId: user("user_id"),
    authorId: user("author_id"),
    kind: text("kind").notNull(),
    questionId: text("question_id").references(
      () => educationQuestionsTable.id,
    ),
    data: jsonb("data").notNull(),
    archived: boolean("archived").notNull().default(false),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [index("education_personal_user_idx").on(t.userId, t.kind)],
);
export const educationAnnouncementsTable = pgTable("education_announcements", {
  id: text("id").primaryKey(),
  classId: text("class_id")
    .notNull()
    .references(() => teacherClassesTable.id),
  authorId: user("author_id"),
  title: text("title").notNull(),
  body: text("body").notNull(),
  archived: boolean("archived").notNull().default(false),
  createdAt: created(),
});
export const educationHelpTable = pgTable("education_help", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(),
  ownerId: user("owner_id"),
  title: text("title").notNull(),
  body: text("body").notNull(),
  role: text("role").notNull().default("all"),
  status: text("status").notNull().default("open"),
  response: text("response").notNull().default(""),
  createdAt: created(),
  updatedAt: updated(),
});
