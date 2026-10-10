import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { usersTable } from "./auth";
const dates = {
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
};
export const teacherProfilesTable = pgTable("teacher_profiles", {
  ownerId: text("owner_id")
    .primaryKey()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
  complete: boolean("complete").notNull().default(false),
  ...dates,
});
export const teacherClassesTable = pgTable(
  "teacher_classes",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    archived: boolean("archived").notNull().default(false),
    ...dates,
  },
  (t) => [
    index("teacher_classes_owner_idx").on(t.ownerId),
    unique().on(t.id, t.ownerId),
  ],
);
export const teacherStudentsTable = pgTable(
  "teacher_students",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    classId: text("class_id").notNull(),
    name: text("name").notNull(),
    internalId: text("internal_id").notNull().default(""),
    notes: text("notes").notNull().default(""),
    archived: boolean("archived").notNull().default(false),
    removed: boolean("removed").notNull().default(false),
    ...dates,
  },
  (t) => [
    index("teacher_students_owner_class_idx").on(t.ownerId, t.classId),
    unique().on(t.id, t.ownerId),
    foreignKey({
      columns: [t.classId, t.ownerId],
      foreignColumns: [teacherClassesTable.id, teacherClassesTable.ownerId],
    }),
    uniqueIndex("teacher_students_internal_unique")
      .on(t.ownerId, t.classId, t.internalId)
      .where(sql`${t.internalId}<>'' AND ${t.removed}=false`),
  ],
);
export const teacherRecordsTable = pgTable(
  "teacher_records",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    classId: text("class_id"),
    studentId: text("student_id"),
    dedupeKey: text("dedupe_key"),
    data: jsonb("data").$type<Record<string, unknown>>().notNull(),
    archived: boolean("archived").notNull().default(false),
    ...dates,
  },
  (t) => [
    index("teacher_records_owner_kind_idx").on(t.ownerId, t.kind),
    unique().on(t.ownerId, t.kind, t.dedupeKey),
    foreignKey({
      columns: [t.classId, t.ownerId],
      foreignColumns: [teacherClassesTable.id, teacherClassesTable.ownerId],
    }),
    foreignKey({
      columns: [t.studentId, t.ownerId],
      foreignColumns: [teacherStudentsTable.id, teacherStudentsTable.ownerId],
    }),
    check(
      "teacher_records_kind_check",
      sql`${t.kind} IN ('attendance','grades','tasks','lessons','questions','assessments')`,
    ),
  ],
);
export const teacherAssetsTable = pgTable(
  "teacher_assets",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    mimeType: text("mime_type").notNull(),
    size: integer("size").notNull(),
    contentBase64: text("content_base64").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("teacher_assets_owner_idx").on(t.ownerId),
    unique().on(t.id, t.ownerId),
    check(
      "teacher_assets_mime_type_check",
      sql`${t.mimeType} IN ('image/jpeg','image/png','image/webp')`,
    ),
    check("teacher_assets_size_check", sql`${t.size}>0 AND ${t.size}<=8388608`),
  ],
);
export const teacherExamsTable = pgTable(
  "teacher_exams",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    document: jsonb("document").$type<Record<string, unknown>>().notNull(),
    sourceAssetId: text("source_asset_id"),
    version: integer("version").notNull().default(1),
    isTemplate: boolean("is_template").notNull().default(false),
    archived: boolean("archived").notNull().default(false),
    ...dates,
  },
  (t) => [
    index("teacher_exams_owner_idx").on(t.ownerId),
    foreignKey({
      columns: [t.sourceAssetId, t.ownerId],
      foreignColumns: [teacherAssetsTable.id, teacherAssetsTable.ownerId],
    }),
    check("teacher_exams_version_check", sql`${t.version}>0`),
  ],
);
export const teacherRulesTable = pgTable(
  "teacher_rules",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    type: text("type").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    config: jsonb("config").$type<Record<string, unknown>>().notNull(),
    nextRunAt: timestamp("next_run_at", { withTimezone: true }),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    lastResult: text("last_result"),
    error: text("error"),
    ...dates,
  },
  (t) => [
    index("teacher_rules_next_run_idx").on(t.enabled, t.nextRunAt),
    check(
      "teacher_rules_type_check",
      sql`${t.type} IN ('upcoming','absence','grading','weekly','draft','recurring')`,
    ),
  ],
);
export const teacherRemindersTable = pgTable(
  "teacher_reminders",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    ruleId: text("rule_id").references(() => teacherRulesTable.id, {
      onDelete: "set null",
    }),
    title: text("title").notNull(),
    body: text("body").notNull(),
    read: boolean("read").notNull().default(false),
    dedupeKey: text("dedupe_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("teacher_reminders_dedupe_unique").on(t.ownerId, t.dedupeKey),
  ],
);
export const teacherRuleRunsTable = pgTable(
  "teacher_rule_runs",
  {
    id: text("id").primaryKey(),
    ruleId: text("rule_id")
      .notNull()
      .references(() => teacherRulesTable.id, { onDelete: "cascade" }),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
    result: text("result").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("teacher_rule_runs_unique").on(t.ruleId, t.scheduledAt)],
);
