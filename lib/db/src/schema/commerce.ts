import { sql } from 'drizzle-orm';
import { boolean, check, integer, numeric, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { storesTable } from './stores';
import { customersTable } from './growth';
import { productsTable } from './catalog';
import { ordersTable } from './orders';
export const couponsTable=pgTable('coupons',{id:text('id').primaryKey(),storeId:text('store_id').notNull().references(()=>storesTable.id,{onDelete:'cascade'}),code:text('code').notNull(),percent:integer('percent').notNull(),minimum:numeric('minimum',{precision:12,scale:2}).notNull().default('0'),maxUses:integer('max_uses').notNull().default(100),uses:integer('uses').notNull().default(0),enabled:boolean('enabled').notNull().default(true),expiresAt:timestamp('expires_at',{withTimezone:true}),createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow()},t=>[uniqueIndex('coupons_store_code_unique').on(t.storeId,t.code),check('coupons_percent_check',sql`${t.percent} BETWEEN 1 AND 100`)]);
export const couponUsesTable=pgTable('coupon_uses',{id:text('id').primaryKey(),couponId:text('coupon_id').notNull().references(()=>couponsTable.id),customerId:text('customer_id').notNull().references(()=>customersTable.id),orderId:text('order_id').notNull().references(()=>ordersTable.id),discount:numeric('discount',{precision:12,scale:2}).notNull(),createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow()},t=>[uniqueIndex('coupon_uses_customer_unique').on(t.couponId,t.customerId),uniqueIndex('coupon_uses_order_unique').on(t.orderId)]);
export const customerProductsTable=pgTable('customer_products',{id:text('id').primaryKey(),customerId:text('customer_id').notNull().references(()=>customersTable.id,{onDelete:'cascade'}),productId:text('product_id').notNull().references(()=>productsTable.id,{onDelete:'cascade'}),favorite:boolean('favorite').notNull().default(false),quantity:integer('quantity').notNull().default(0)},t=>[uniqueIndex('customer_products_unique').on(t.customerId,t.productId),check('customer_products_quantity_check',sql`${t.quantity} BETWEEN 0 AND 20`)]);
export const reviewsTable=pgTable('product_reviews',{id:text('id').primaryKey(),storeId:text('store_id').notNull().references(()=>storesTable.id,{onDelete:'cascade'}),customerId:text('customer_id').notNull().references(()=>customersTable.id),productId:text('product_id').notNull().references(()=>productsTable.id),stars:integer('stars').notNull(),createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow()},t=>[uniqueIndex('product_reviews_customer_unique').on(t.customerId,t.productId),check('product_reviews_stars_check',sql`${t.stars} BETWEEN 1 AND 5`)]);
export const referralsTable=pgTable('customer_referrals',{id:text('id').primaryKey(),storeId:text('store_id').notNull().references(()=>storesTable.id,{onDelete:'cascade'}),referrerId:text('referrer_id').notNull().references(()=>customersTable.id),customerId:text('customer_id').notNull().references(()=>customersTable.id),completed:boolean('completed').notNull().default(false),createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow()},t=>[uniqueIndex('customer_referrals_new_unique').on(t.customerId),check('customer_referrals_check',sql`${t.referrerId} <> ${t.customerId}`)]);
// A payment transition may be delivered more than once. This durable receipt
// prevents both order rewards and referral rewards from being issued twice.
export const commerceRewardsTable = pgTable('commerce_order_rewards', {
  orderId: text('order_id').primaryKey().references(() => ordersTable.id),
  storeId: text('store_id').notNull().references(() => storesTable.id, { onDelete: 'cascade' }),
  customerId: text('customer_id').notNull().references(() => customersTable.id),
  points: integer('points').notNull().default(0),
  referrerId: text('referrer_id').references(() => customersTable.id),
  referralPoints: integer('referral_points').notNull().default(0),
  reversed: boolean('reversed').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [
  check('commerce_order_rewards_points_check', sql`${table.points} >= 0`),
  check('commerce_order_rewards_referral_points_check', sql`${table.referralPoints} >= 0`),
]);
