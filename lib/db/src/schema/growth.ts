import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { storesTable } from './stores';

export const customersTable = pgTable('customers', {
  id: text('id').primaryKey(), storeId: text('store_id').notNull().references(() => storesTable.id, { onDelete: 'cascade' }),
  telegramUserId: text('telegram_user_id').notNull(), telegramChatId: text('telegram_chat_id').notNull(),
  name: text('name').notNull(), username: text('username'), optedIn: boolean('opted_in').notNull().default(true),
  tags: jsonb('tags').$type<string[]>().notNull().default([]), segments: jsonb('segments').$type<string[]>().notNull().default([]),
  vipLevel: integer('vip_level').notNull().default(0), points: integer('points').notNull().default(0),
  state: jsonb('state').$type<Record<string, unknown>>().notNull().default({}),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(), createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [uniqueIndex('customers_store_telegram_unique').on(t.storeId, t.telegramUserId), index('customers_store_seen_idx').on(t.storeId, t.lastSeenAt)]);

export const growthResourcesTable = pgTable('growth_resources', {
  id: text('id').primaryKey(), storeId: text('store_id').notNull().references(() => storesTable.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(), name: text('name').notNull(), enabled: boolean('enabled').notNull().default(false),
  status: text('status').notNull().default('draft'), configuration: jsonb('configuration').$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [index('growth_resources_store_kind_idx').on(t.storeId, t.kind)]);

export const growthJobsTable = pgTable('growth_jobs', {
  id: text('id').primaryKey(), storeId: text('store_id').notNull().references(() => storesTable.id, { onDelete: 'cascade' }),
  resourceId: text('resource_id').references(() => growthResourcesTable.id, { onDelete: 'cascade' }),
  customerId: text('customer_id').references(() => customersTable.id, { onDelete: 'cascade' }),
  dedupeKey: text('dedupe_key').notNull(), payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
  status: text('status').notNull().default('queued'), attempts: integer('attempts').notNull().default(0),
  availableAt: timestamp('available_at', { withTimezone: true }).notNull().defaultNow(), lockedUntil: timestamp('locked_until', { withTimezone: true }),
  lastError: text('last_error'), completedAt: timestamp('completed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [uniqueIndex('growth_jobs_store_dedupe_unique').on(t.storeId, t.dedupeKey), index('growth_jobs_status_available_idx').on(t.status, t.availableAt)]);

export const customerLedgerTable = pgTable('customer_point_ledger', {
  id: text('id').primaryKey(), storeId: text('store_id').notNull().references(() => storesTable.id, { onDelete: 'cascade' }),
  customerId: text('customer_id').notNull().references(() => customersTable.id, { onDelete: 'cascade' }),
  jobId: text('job_id').unique().references(() => growthJobsTable.id, { onDelete: 'set null' }),
  amount: integer('amount').notNull(), reason: text('reason').notNull(), createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
