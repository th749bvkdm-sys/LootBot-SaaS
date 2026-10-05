import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const schemaMigrationsTable = pgTable('lootbot_schema_migrations', {
  name: text('name').primaryKey(),
  checksum: text('checksum').notNull(),
  appliedAt: timestamp('applied_at', { withTimezone: true }).notNull().defaultNow(),
});
