-- Restore the original commerce invariants when older schema pushes removed
-- undeclared CHECK constraints. The Drizzle schema declares the same names.
-- Leave existing records and already validated constraints untouched.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'coupons'::regclass AND conname = 'coupons_percent_check') THEN
    ALTER TABLE coupons ADD CONSTRAINT coupons_percent_check CHECK (percent BETWEEN 1 AND 100);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'customer_products'::regclass AND conname = 'customer_products_quantity_check') THEN
    ALTER TABLE customer_products ADD CONSTRAINT customer_products_quantity_check CHECK (quantity BETWEEN 0 AND 20);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'product_reviews'::regclass AND conname = 'product_reviews_stars_check') THEN
    ALTER TABLE product_reviews ADD CONSTRAINT product_reviews_stars_check CHECK (stars BETWEEN 1 AND 5);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'customer_referrals'::regclass AND conname = 'customer_referrals_check') THEN
    ALTER TABLE customer_referrals ADD CONSTRAINT customer_referrals_check CHECK (referrer_id <> customer_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'commerce_order_rewards'::regclass AND conname = 'commerce_order_rewards_points_check') THEN
    ALTER TABLE commerce_order_rewards ADD CONSTRAINT commerce_order_rewards_points_check CHECK (points >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'commerce_order_rewards'::regclass AND conname = 'commerce_order_rewards_referral_points_check') THEN
    ALTER TABLE commerce_order_rewards ADD CONSTRAINT commerce_order_rewards_referral_points_check CHECK (referral_points >= 0);
  END IF;
END $$;
