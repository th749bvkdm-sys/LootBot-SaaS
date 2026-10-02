import { createInsertSchema } from "drizzle-zod";
import { boolean, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { usersTable } from "./auth";

export const storesTable = pgTable("stores", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  currency: text("currency").notNull().default("USD"),
  botStatus: text("bot_status").notNull().default("disconnected"),
  isDemo: boolean("is_demo").notNull().default(false),
  isDeleted: boolean("is_deleted").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const storeSettingsTable = pgTable("store_settings", {
  storeId: text("store_id")
    .primaryKey()
    .references(() => storesTable.id, { onDelete: "cascade" }),
  settings: jsonb("settings").$type<Record<string, unknown>>().notNull().default({}),
  referralsEnabled: boolean("referrals_enabled").notNull().default(false),
  pointsEnabled: boolean("points_enabled").notNull().default(false),
  reviewsEnabled: boolean("reviews_enabled").notNull().default(false),
  couponsEnabled: boolean("coupons_enabled").notNull().default(true),
  vipEnabled: boolean("vip_enabled").notNull().default(false),
  supportEnabled: boolean("support_enabled").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertStoreSchema = createInsertSchema(storesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertStore = z.infer<typeof insertStoreSchema>;
export type Store = typeof storesTable.$inferSelect;
export type StoreSettings = typeof storeSettingsTable.$inferSelect;