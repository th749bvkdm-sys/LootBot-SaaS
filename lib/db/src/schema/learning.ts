import {
  pgTable,
  text,
  integer,
  boolean,
  jsonb,
  timestamp,
  index,
  unique,
  foreignKey,
} from "drizzle-orm/pg-core";
import { usersTable } from "./auth";
import {
  teacherClassesTable,
  teacherStudentsTable,
  teacherRecordsTable,
} from "./teacher";
const stamp = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
export const teacherClassAccessTable = pgTable(
  "teacher_class_access",
  {
    classId: text("class_id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    codeHash: text("code_hash").notNull().unique(),
    enabled: boolean("enabled").notNull().default(true),
  },
  (t) => [
    foreignKey({
      columns: [t.classId, t.ownerId],
      foreignColumns: [teacherClassesTable.id, teacherClassesTable.ownerId],
    }).onDelete("cascade"),
  ],
);
export const teacherStudentAccessTable = pgTable(
  "teacher_student_access",
  {
    studentId: text("student_id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    codeHash: text("code_hash").notNull(),
    enabled: boolean("enabled").notNull().default(true),
  },
  (t) => [
    foreignKey({
      columns: [t.studentId, t.ownerId],
      foreignColumns: [teacherStudentsTable.id, teacherStudentsTable.ownerId],
    }).onDelete("cascade"),
  ],
);
export const teacherStudentSessionsTable = pgTable(
  "teacher_student_sessions",
  {
    id: text("id").primaryKey(),
    tokenHash: text("token_hash").notNull().unique(),
    csrfHash: text("csrf_hash").notNull(),
    studentId: text("student_id").notNull(),
    classId: text("class_id").notNull(),
    ownerId: text("owner_id").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.studentId, t.ownerId],
      foreignColumns: [teacherStudentsTable.id, teacherStudentsTable.ownerId],
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.classId, t.ownerId],
      foreignColumns: [teacherClassesTable.id, teacherClassesTable.ownerId],
    }).onDelete("cascade"),
    index("teacher_student_sessions_student_idx").on(t.studentId, t.classId),
  ],
);
export const teacherEntryLimitsTable = pgTable("teacher_entry_limits", {
  key: text("key").primaryKey(),
  attempts: integer("attempts").notNull().default(1),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});
export const teacherActivitiesTable = pgTable(
  "teacher_activities",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    draft: jsonb("draft").notNull(),
    revision: integer("revision").notNull().default(1),
    currentVersionId: text("current_version_id"),
    status: text("status").notNull().default("draft"),
    createdAt: stamp(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique().on(t.id, t.ownerId),
    index("teacher_activities_owner_idx").on(t.ownerId),
  ],
);
export const teacherActivityVersionsTable = pgTable(
  "teacher_activity_versions",
  {
    id: text("id").primaryKey(),
    activityId: text("activity_id").notNull(),
    ownerId: text("owner_id").notNull(),
    number: integer("number").notNull(),
    content: jsonb("content").notNull(),
    createdAt: stamp(),
  },
  (t) => [
    unique().on(t.id, t.ownerId),
    unique().on(t.activityId, t.number),
    foreignKey({
      columns: [t.activityId, t.ownerId],
      foreignColumns: [
        teacherActivitiesTable.id,
        teacherActivitiesTable.ownerId,
      ],
    }).onDelete("cascade"),
  ],
);
export const teacherActivityAssignmentsTable = pgTable(
  "teacher_activity_assignments",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    versionId: text("version_id").notNull(),
    classId: text("class_id").notNull(),
    mode: text("mode").notNull().default("learn"),
    allowedAttempts: integer("allowed_attempts").notNull().default(3),
    hints: boolean("hints").notNull().default(true),
    explanations: text("explanations").notNull().default("immediate"),
    dueAt: timestamp("due_at", { withTimezone: true }),
    archived: boolean("archived").notNull().default(false),
    createdAt: stamp(),
  },
  (t) => [
    unique().on(t.id, t.ownerId),
    foreignKey({
      columns: [t.versionId, t.ownerId],
      foreignColumns: [
        teacherActivityVersionsTable.id,
        teacherActivityVersionsTable.ownerId,
      ],
    }),
    foreignKey({
      columns: [t.classId, t.ownerId],
      foreignColumns: [teacherClassesTable.id, teacherClassesTable.ownerId],
    }),
    index("teacher_activity_assignments_class_idx").on(t.ownerId, t.classId),
  ],
);
export const teacherActivityProgressTable = pgTable(
  "teacher_activity_progress",
  {
    id: text("id").primaryKey(),
    assignmentId: text("assignment_id").notNull(),
    studentId: text("student_id").notNull(),
    ownerId: text("owner_id").notNull(),
    run: integer("run").notNull().default(1),
    currentStepId: text("current_step_id").notNull(),
    reachedIds: jsonb("reached_ids").notNull().default([]),
    passedIds: jsonb("passed_ids").notNull().default([]),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    unique().on(t.assignmentId, t.studentId),
    foreignKey({
      columns: [t.assignmentId, t.ownerId],
      foreignColumns: [
        teacherActivityAssignmentsTable.id,
        teacherActivityAssignmentsTable.ownerId,
      ],
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.studentId, t.ownerId],
      foreignColumns: [teacherStudentsTable.id, teacherStudentsTable.ownerId],
    }),
  ],
);
export const teacherActivityEventsTable = pgTable(
  "teacher_activity_events",
  {
    id: text("id").primaryKey(),
    assignmentId: text("assignment_id").notNull(),
    studentId: text("student_id").notNull(),
    ownerId: text("owner_id").notNull(),
    stepId: text("step_id").notNull(),
    run: integer("run").notNull(),
    type: text("type").notNull(),
    requestKey: text("request_key").notNull(),
    payload: jsonb("payload").notNull().default({}),
    createdAt: stamp(),
  },
  (t) => [
    unique().on(t.assignmentId, t.studentId, t.requestKey),
    foreignKey({
      columns: [t.assignmentId, t.ownerId],
      foreignColumns: [
        teacherActivityAssignmentsTable.id,
        teacherActivityAssignmentsTable.ownerId,
      ],
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.studentId, t.ownerId],
      foreignColumns: [teacherStudentsTable.id, teacherStudentsTable.ownerId],
    }),
    index("teacher_activity_events_step_student_idx").on(
      t.assignmentId,
      t.stepId,
      t.studentId,
    ),
  ],
);
export const teacherQuestionVersionsTable = pgTable(
  "teacher_question_versions",
  {
    id: text("id").primaryKey(),
    questionId: text("question_id")
      .notNull()
      .references(() => teacherRecordsTable.id, { onDelete: "cascade" }),
    ownerId: text("owner_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    content: jsonb("content").notNull(),
    createdAt: stamp(),
  },
  (t) => [
    unique().on(t.questionId, t.number),
    unique().on(t.id, t.ownerId),
    index("teacher_question_versions_owner_idx").on(t.ownerId, t.questionId),
  ],
);
export const teacherRosterSnapshotsTable=pgTable('teacher_roster_snapshots',{id:text('id').primaryKey(),ownerId:text('owner_id').notNull(),classId:text('class_id').notNull(),term:text('term').notNull(),students:jsonb('students').notNull(),createdAt:stamp()},t=>[foreignKey({columns:[t.classId,t.ownerId],foreignColumns:[teacherClassesTable.id,teacherClassesTable.ownerId]}),index('teacher_roster_snapshots_class_idx').on(t.ownerId,t.classId)]);
export const teacherTemplateSharesTable=pgTable('teacher_template_shares',{id:text('id').primaryKey(),ownerId:text('owner_id').notNull().references(()=>usersTable.id,{onDelete:'cascade'}),tokenHash:text('token_hash').notNull().unique(),content:jsonb('content').notNull(),enabled:boolean('enabled').notNull().default(true),createdAt:stamp()});
