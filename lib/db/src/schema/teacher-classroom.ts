import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  jsonb,
  integer,
  date,
  timestamp,
  foreignKey,
  index,
  check,
  primaryKey,
} from "drizzle-orm/pg-core";
import { usersTable } from "./auth";
import { teacherClassesTable } from "./teacher";

/** Keep the application schema aligned with the additive 0021 migration. */
export const teacherClassroomEventsTable = pgTable(
  "teacher_classroom_events",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    classId: text("class_id").notNull(),
    studentIds: jsonb("student_ids").$type<string[]>().notNull().default([]),
    points: integer("points").notNull(),
    reason: text("reason").notNull(),
    day: date("day", { mode: "string" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "teacher_classroom_events_owner_id_fkey",
      columns: [t.ownerId],
      foreignColumns: [usersTable.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "teacher_classroom_events_class_id_owner_id_fkey",
      columns: [t.classId, t.ownerId],
      foreignColumns: [teacherClassesTable.id, teacherClassesTable.ownerId],
    }).onDelete("cascade"),
    index("teacher_classroom_events_class_idx").on(t.ownerId, t.classId, t.day),
    check(
      "teacher_classroom_events_points_check",
      sql`${t.points} BETWEEN 1 AND 1000`,
    ),
    check(
      "teacher_classroom_events_reason_check",
      sql`char_length(${t.reason}) BETWEEN 1 AND 200`,
    ),
  ],
);
export const teacherClassroomDaysTable = pgTable(
  "teacher_classroom_days",
  {
    ownerId: text("owner_id").notNull(),
    classId: text("class_id").notNull(),
    day: date("day", { mode: "string" }).notNull(),
  },
  (t) => [
    primaryKey({
      name: "teacher_classroom_days_pkey",
      columns: [t.ownerId, t.classId, t.day],
    }),
    foreignKey({
      name: "teacher_classroom_days_class_id_owner_id_fkey",
      columns: [t.classId, t.ownerId],
      foreignColumns: [teacherClassesTable.id, teacherClassesTable.ownerId],
    }).onDelete("cascade"),
  ],
);
