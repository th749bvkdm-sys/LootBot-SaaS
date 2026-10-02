import { createInsertSchema } from "drizzle-zod";
import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { storesTable } from "./stores";

export const telegramBotsTable = pgTable("telegram_bots", {
  storeId: text("store_id")
    .primaryKey()
    .references(() => storesTable.id, { onDelete: "cascade" }),
  encryptedToken: text("encrypted_token").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  telegramBotId: text("telegram_bot_id").notNull(),
  username: text("username"),
  firstName: text("first_name"),
  status: text("status").notNull().default("connected"),
  lastError: text("last_error"),
  lastUpdateId: text("last_update_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertTelegramBotSchema = createInsertSchema(telegramBotsTable).omit({
  createdAt: true,
  updatedAt: true,
});
export type TelegramBot = typeof telegramBotsTable.$inferSelect;
export type InsertTelegramBot = z.infer<typeof insertTelegramBotSchema>;