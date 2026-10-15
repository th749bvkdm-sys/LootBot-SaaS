import { bigint, boolean, index, integer, jsonb, pgTable, primaryKey, text, timestamp, unique } from 'drizzle-orm/pg-core';
import { usersTable } from './auth';
import { teacherClassesTable } from './teacher';
import { educationEnrollmentsTable, educationQuestionsTable, educationQuestionVersionsTable, educationSchoolsTable } from './education';

const stamp = (name: string) => timestamp(name, { withTimezone: true }).notNull().defaultNow();
export const quantSourcesTable = pgTable('quant_sources', {
  id: text('id').primaryKey(), title: text('title').notNull(), fileName: text('file_name').notNull().default(''),
  fileHash: text('file_hash').notNull().unique(), fileSize: bigint('file_size', { mode: 'number' }).notNull().default(0),
  sourceUrl: text('source_url').notNull().default(''), pageCount: integer('page_count'),
  licenseStatus: text('license_status').notNull().default('unverified'), licenseNote: text('license_note').notNull().default(''),
  attribution: text('attribution').notNull().default(''), privatePath: text('private_path').notNull().default(''),
  createdBy: text('created_by').notNull().references(() => usersTable.id), createdAt: stamp('created_at'), updatedAt: stamp('updated_at'),
});
export const quantQuestionReviewsTable = pgTable('quant_question_reviews', {
  versionId: text('version_id').primaryKey().references(() => educationQuestionVersionsTable.id),
  questionId: text('question_id').notNull().references(() => educationQuestionsTable.id),
  sourceId: text('source_id').references(() => quantSourcesTable.id), sourcePage: integer('source_page'),
  reviewStatus: text('review_status').notNull().default('draft'), normalizedHash: text('normalized_hash').notNull(),
  skill: text('skill').notNull(), reviewNote: text('review_note').notNull().default(''),
  reviewedBy: text('reviewed_by').references(() => usersTable.id), updatedAt: stamp('updated_at'),
}, t => [index('quant_reviews_question_idx').on(t.questionId), index('quant_reviews_source_idx').on(t.sourceId), index('quant_reviews_skill_idx').on(t.skill), index('quant_reviews_hash_idx').on(t.normalizedHash)]);
export const quantQuestionSourcesTable = pgTable('quant_question_sources', {
  id: text('id').primaryKey(), questionId: text('question_id').notNull().references(() => educationQuestionsTable.id),
  sourceId: text('source_id').notNull().references(() => quantSourcesTable.id), sourcePage: integer('source_page').notNull(),
}, t => [unique('quant_question_source_page_unique').on(t.questionId, t.sourceId, t.sourcePage)]);
export const quantExtractionPagesTable = pgTable('quant_extraction_pages', {
  sourceId: text('source_id').notNull().references(() => quantSourcesTable.id), page: integer('page').notNull(),
  status: text('status').notNull(), textExcerpt: text('text_excerpt').notNull().default(''), reason: text('reason').notNull().default(''),
  questionId: text('question_id').references(() => educationQuestionsTable.id), processedAt: stamp('processed_at'),
}, t => [primaryKey({ columns: [t.sourceId, t.page] })]);
export const quantExtractionJobsTable = pgTable('quant_extraction_jobs', {
  id: text('id').primaryKey(), sourceId: text('source_id').notNull().references(() => quantSourcesTable.id),
  status: text('status').notNull().default('pending'), startedAt: timestamp('started_at', { withTimezone: true }),
  finishedAt: timestamp('finished_at', { withTimezone: true }), error: text('error').notNull().default(''),
  createdBy: text('created_by').notNull().references(() => usersTable.id),
  createdAt: stamp('created_at'),
}, t => [index('quant_extraction_source_idx').on(t.sourceId)]);
export const quantTestsTable = pgTable('quant_tests', {
  id: text('id').primaryKey(), title: text('title').notNull(), description: text('description').notNull().default(''),
  mode: text('mode').notNull(), timeLimitSec: integer('time_limit_sec'), allowReturn: boolean('allow_return').notNull().default(true),
  revealPolicy: text('reveal_policy').notNull().default('after_submit'), revealAt: timestamp('reveal_at', { withTimezone: true }),
  status: text('status').notNull().default('draft'), schoolId: text('school_id').references(() => educationSchoolsTable.id),
  classId: text('class_id').references(() => teacherClassesTable.id), stage: text('stage').notNull().default(''),
  createdBy: text('created_by').notNull().references(() => usersTable.id), createdAt: stamp('created_at'), updatedAt: stamp('updated_at'),
}, t => [index('quant_tests_scope_idx').on(t.status, t.schoolId, t.classId)]);
export const quantTestItemsTable = pgTable('quant_test_items', {
  testId: text('test_id').notNull().references(() => quantTestsTable.id, { onDelete: 'cascade' }),
  versionId: text('version_id').notNull().references(() => educationQuestionVersionsTable.id), position: integer('position').notNull(),
}, t => [primaryKey({ columns: [t.testId, t.position] }), unique('quant_test_version_unique').on(t.testId, t.versionId)]);
export const quantAttemptsTable = pgTable('quant_attempts', {
  id: text('id').primaryKey(), testId: text('test_id').references(() => quantTestsTable.id),
  userId: text('user_id').notNull().references(() => usersTable.id), enrollmentId: text('enrollment_id').notNull().references(() => educationEnrollmentsTable.id),
  schoolId: text('school_id').notNull().references(() => educationSchoolsTable.id), classId: text('class_id').references(() => teacherClassesTable.id),
  testSnapshot: jsonb('test_snapshot').notNull(), snapshot: jsonb('snapshot').notNull(),
  startedAt: stamp('started_at'), deadlineAt: timestamp('deadline_at', { withTimezone: true }), submittedAt: timestamp('submitted_at', { withTimezone: true }),
  status: text('status').notNull().default('in_progress'), currentIndex: integer('current_index').notNull().default(0), checkpointAt: stamp('checkpoint_at'),
}, t => [index('quant_attempt_user_idx').on(t.userId, t.startedAt), index('quant_attempt_test_idx').on(t.testId), index('quant_attempt_deadline_idx').on(t.status, t.deadlineAt)]);
export const quantResponsesTable = pgTable('quant_responses', {
  attemptId: text('attempt_id').notNull().references(() => quantAttemptsTable.id, { onDelete: 'cascade' }),
  versionId: text('version_id').notNull().references(() => educationQuestionVersionsTable.id), choiceKey: text('choice_key'),
  flagged: boolean('flagged').notNull().default(false), visited: boolean('visited').notNull().default(false),
  revision: integer('revision').notNull().default(0), changeCount: integer('change_count').notNull().default(0),
  timeSpentMs: bigint('time_spent_ms', { mode: 'number' }).notNull().default(0), updatedAt: stamp('updated_at'),
  firstAnsweredAt: timestamp('first_answered_at', { withTimezone: true }),
}, t => [primaryKey({ columns: [t.attemptId, t.versionId] })]);
export const quantScratchpadsTable = pgTable('quant_scratchpads', {
  attemptId: text('attempt_id').notNull().references(() => quantAttemptsTable.id, { onDelete: 'cascade' }),
  versionId: text('version_id').notNull().references(() => educationQuestionVersionsTable.id),
  strokes: jsonb('strokes').notNull().default([]), revision: integer('revision').notNull().default(0), updatedAt: stamp('updated_at'),
}, t => [primaryKey({ columns: [t.attemptId, t.versionId] })]);
