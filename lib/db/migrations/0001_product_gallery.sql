-- Additive gallery migration. Existing image_url values remain unchanged;
-- the API reads them as the primary image until a gallery is saved.
CREATE TABLE IF NOT EXISTS product_images (
  id text PRIMARY KEY,
  product_id text NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  image_url text NOT NULL,
  alt_text text NOT NULL DEFAULT '',
  sort_order integer NOT NULL DEFAULT 0,
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS product_images_product_sort_unique
  ON product_images(product_id, sort_order);
CREATE UNIQUE INDEX IF NOT EXISTS product_images_primary_unique
  ON product_images(product_id) WHERE is_primary = true;
