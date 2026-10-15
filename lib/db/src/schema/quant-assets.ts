import { index, integer, pgTable, text, timestamp, unique } from 'drizzle-orm/pg-core';
import { usersTable } from './auth';
import { educationQuestionVersionsTable } from './education';
import { quantSourcesTable } from './quant';

export const quantQuestionFiguresTable = pgTable('quant_question_figures', {
  id: text('id').primaryKey(), versionId: text('version_id').notNull().references(() => educationQuestionVersionsTable.id),
  sourceId: text('source_id').notNull().references(() => quantSourcesTable.id), sourcePage: integer('source_page').notNull(),
  position: integer('position').notNull(), fileHash: text('file_hash').notNull(), relativePath: text('relative_path').notNull(),
  width: integer('width').notNull(), height: integer('height').notNull(), reviewNote: text('review_note').notNull(),
  createdBy: text('created_by').notNull().references(() => usersTable.id), createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [unique('quant_figure_version_position_unique').on(t.versionId, t.position), index('quant_figure_source_idx').on(t.sourceId)]);
