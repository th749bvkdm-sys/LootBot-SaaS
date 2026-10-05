import { boolean, index, jsonb, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { storesTable } from './stores';
import { usersTable } from './auth';

export const storeMembersTable = pgTable('store_members', {
  id: text('id').primaryKey(),
  storeId: text('store_id').notNull().references(() => storesTable.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => usersTable.id, { onDelete: 'cascade' }),
  invitedBy: text('invited_by').notNull().references(() => usersTable.id),
  permissions: jsonb('permissions').$type<string[]>().notNull().default([]),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [uniqueIndex('store_members_store_user_unique').on(table.storeId, table.userId), index('store_members_user_enabled_idx').on(table.userId, table.enabled)]);
