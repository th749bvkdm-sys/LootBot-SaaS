CREATE TABLE IF NOT EXISTS coupons (id text PRIMARY KEY, store_id text NOT NULL REFERENCES stores(id) ON DELETE CASCADE, code text NOT NULL, percent integer NOT NULL CHECK(percent BETWEEN 1 AND 100), minimum numeric(12,2) NOT NULL DEFAULT 0, max_uses integer NOT NULL DEFAULT 100, uses integer NOT NULL DEFAULT 0, enabled boolean NOT NULL DEFAULT true, expires_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX IF NOT EXISTS coupons_store_code_unique ON coupons(store_id,code);
CREATE TABLE IF NOT EXISTS coupon_uses (id text PRIMARY KEY, coupon_id text NOT NULL REFERENCES coupons(id), customer_id text NOT NULL REFERENCES customers(id), order_id text NOT NULL REFERENCES orders(id), discount numeric(12,2) NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX IF NOT EXISTS coupon_uses_customer_unique ON coupon_uses(coupon_id,customer_id);
CREATE UNIQUE INDEX IF NOT EXISTS coupon_uses_order_unique ON coupon_uses(order_id);
CREATE TABLE IF NOT EXISTS customer_products (id text PRIMARY KEY, customer_id text NOT NULL REFERENCES customers(id) ON DELETE CASCADE, product_id text NOT NULL REFERENCES products(id) ON DELETE CASCADE, favorite boolean NOT NULL DEFAULT false, quantity integer NOT NULL DEFAULT 0 CHECK(quantity BETWEEN 0 AND 20));
CREATE UNIQUE INDEX IF NOT EXISTS customer_products_unique ON customer_products(customer_id,product_id);
CREATE TABLE IF NOT EXISTS product_reviews (id text PRIMARY KEY, store_id text NOT NULL REFERENCES stores(id) ON DELETE CASCADE, customer_id text NOT NULL REFERENCES customers(id), product_id text NOT NULL REFERENCES products(id), stars integer NOT NULL CHECK(stars BETWEEN 1 AND 5), created_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX IF NOT EXISTS product_reviews_customer_unique ON product_reviews(customer_id,product_id);
CREATE TABLE IF NOT EXISTS customer_referrals (id text PRIMARY KEY, store_id text NOT NULL REFERENCES stores(id) ON DELETE CASCADE, referrer_id text NOT NULL REFERENCES customers(id), customer_id text NOT NULL REFERENCES customers(id), completed boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(), CHECK(referrer_id<>customer_id));
CREATE UNIQUE INDEX IF NOT EXISTS customer_referrals_new_unique ON customer_referrals(customer_id);
CREATE TABLE IF NOT EXISTS commerce_order_rewards (
  order_id text PRIMARY KEY REFERENCES orders(id),
  store_id text NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  customer_id text NOT NULL REFERENCES customers(id),
  points integer NOT NULL DEFAULT 0 CHECK(points >= 0),
  referrer_id text REFERENCES customers(id),
  referral_points integer NOT NULL DEFAULT 0 CHECK(referral_points >= 0),
  reversed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
