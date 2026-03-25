-- ============================================================
-- LaBrew V2: Self-Service Café + Honesty Store
-- Full database migration
-- ============================================================

-- Enums
CREATE TYPE product_type AS ENUM ('cafe', 'retail');
CREATE TYPE order_source AS ENUM ('fridge', 'cafe');
CREATE TYPE order_status AS ENUM ('new', 'preparing', 'ready', 'completed', 'cancelled');
CREATE TYPE payment_method AS ENUM ('cash', 'gcash', 'bank_transfer');
CREATE TYPE proof_status AS ENUM ('none', 'uploaded', 'confirmed', 'flagged');
CREATE TYPE movement_type AS ENUM ('sale', 'restock', 'adjustment', 'spoilage');
CREATE TYPE user_role AS ENUM ('admin', 'barista');

-- ============================================================
-- Profiles (role-based access)
-- ============================================================
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL DEFAULT '',
  role user_role NOT NULL DEFAULT 'barista',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read own profile" ON profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Service role full access" ON profiles FOR ALL USING (true) WITH CHECK (true);

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, full_name, role)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', ''), 'barista');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ============================================================
-- Products (v2: image_url)
-- ============================================================
CREATE TABLE products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  type product_type NOT NULL,
  selling_price NUMERIC(10,2) NOT NULL,
  base_cost NUMERIC(10,2),
  image_url TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  low_stock_threshold INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_products_type ON products(type);
CREATE INDEX idx_products_active ON products(active);

-- ============================================================
-- Ingredients
-- ============================================================
CREATE TABLE ingredients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  unit TEXT NOT NULL,
  unit_cost NUMERIC(10,4) NOT NULL,
  stock NUMERIC(12,4) NOT NULL DEFAULT 0,
  low_stock_threshold NUMERIC(12,4) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- Recipes
-- ============================================================
CREATE TABLE recipes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  ingredient_id UUID NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
  qty_required NUMERIC(10,4) NOT NULL,
  UNIQUE(product_id, ingredient_id)
);

CREATE INDEX idx_recipes_product ON recipes(product_id);

-- ============================================================
-- Retail Stock
-- ============================================================
CREATE TABLE retail_stock (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE UNIQUE,
  stock INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_retail_stock_product ON retail_stock(product_id);

-- ============================================================
-- Order number sequences
-- ============================================================
CREATE SEQUENCE cafe_order_seq START 1;
CREATE SEQUENCE fridge_order_seq START 1;

-- ============================================================
-- Orders (v2: order_number, payment_confirmed, timestamps, snapshot)
-- ============================================================
CREATE TABLE orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number TEXT,
  source order_source NOT NULL,
  status order_status NOT NULL DEFAULT 'new',
  payment_method payment_method NOT NULL DEFAULT 'cash',
  payment_proof_url TEXT,
  payment_proof_status proof_status NOT NULL DEFAULT 'none',
  payment_confirmed BOOLEAN NOT NULL DEFAULT false,
  order_snapshot_url TEXT,
  notes TEXT,
  total_price NUMERIC(10,2) NOT NULL DEFAULT 0,
  total_cost NUMERIC(10,2) NOT NULL DEFAULT 0,
  margin NUMERIC(10,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  preparing_at TIMESTAMPTZ,
  ready_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_source ON orders(source);
CREATE INDEX idx_orders_created ON orders(created_at DESC);
CREATE INDEX idx_orders_number ON orders(order_number);

-- Auto-generate order number
CREATE OR REPLACE FUNCTION generate_order_number()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.source = 'cafe' THEN
    NEW.order_number := 'CF-' || LPAD(nextval('cafe_order_seq')::TEXT, 4, '0');
  ELSE
    NEW.order_number := 'FR-' || LPAD(nextval('fridge_order_seq')::TEXT, 4, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_order_number
  BEFORE INSERT ON orders
  FOR EACH ROW EXECUTE FUNCTION generate_order_number();

-- Auto-set status timestamps
CREATE OR REPLACE FUNCTION set_status_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'preparing' AND OLD.status != 'preparing' THEN
    NEW.preparing_at := now();
  END IF;
  IF NEW.status = 'ready' AND OLD.status != 'ready' THEN
    NEW.ready_at := now();
  END IF;
  IF NEW.status = 'completed' AND OLD.status != 'completed' THEN
    NEW.completed_at := now();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_status_timestamp
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION set_status_timestamp();

-- ============================================================
-- Order Items
-- ============================================================
CREATE TABLE order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id),
  qty INTEGER NOT NULL,
  price_at_sale NUMERIC(10,2) NOT NULL,
  cost_at_sale NUMERIC(10,2) NOT NULL DEFAULT 0
);

CREATE INDEX idx_order_items_order ON order_items(order_id);

-- ============================================================
-- Inventory Movements
-- ============================================================
CREATE TABLE inventory_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_type TEXT NOT NULL,
  item_id UUID NOT NULL,
  quantity_delta NUMERIC(12,4) NOT NULL,
  movement_type movement_type NOT NULL,
  reference_order_id UUID REFERENCES orders(id),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_inv_movements_item ON inventory_movements(item_type, item_id);
CREATE INDEX idx_inv_movements_order ON inventory_movements(reference_order_id);

-- ============================================================
-- Realtime
-- ============================================================
ALTER PUBLICATION supabase_realtime ADD TABLE orders;

-- ============================================================
-- Storage buckets
-- ============================================================
INSERT INTO storage.buckets (id, name, public) VALUES ('product-images', 'product-images', true);
INSERT INTO storage.buckets (id, name, public) VALUES ('payment-proofs', 'payment-proofs', true);
INSERT INTO storage.buckets (id, name, public) VALUES ('order-snapshots', 'order-snapshots', true);

-- Storage policies: public read + upload
CREATE POLICY "Public upload product-images" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'product-images');
CREATE POLICY "Public read product-images" ON storage.objects FOR SELECT USING (bucket_id = 'product-images');
CREATE POLICY "Public upload payment-proofs" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'payment-proofs');
CREATE POLICY "Public read payment-proofs" ON storage.objects FOR SELECT USING (bucket_id = 'payment-proofs');
CREATE POLICY "Public upload order-snapshots" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'order-snapshots');
CREATE POLICY "Public read order-snapshots" ON storage.objects FOR SELECT USING (bucket_id = 'order-snapshots');

-- ============================================================
-- RLS (kiosk = public read, server actions handle writes)
-- ============================================================
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read products" ON products FOR SELECT USING (true);
CREATE POLICY "Admin write products" ON products FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE ingredients ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read ingredients" ON ingredients FOR SELECT USING (true);
CREATE POLICY "Admin write ingredients" ON ingredients FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE recipes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read recipes" ON recipes FOR SELECT USING (true);
CREATE POLICY "Admin write recipes" ON recipes FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE retail_stock ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read retail_stock" ON retail_stock FOR SELECT USING (true);
CREATE POLICY "Admin write retail_stock" ON retail_stock FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public all orders" ON orders FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public all order_items" ON order_items FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE inventory_movements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public all inventory_movements" ON inventory_movements FOR ALL USING (true) WITH CHECK (true);

-- ============================================================
-- V3: Accountability + HitPay + Risk Flags
-- ============================================================

-- Orders: accountability
ALTER TABLE orders ADD COLUMN IF NOT EXISTS confirmed_by UUID REFERENCES profiles(id);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ;

-- Orders: customer identity (optional)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_name TEXT;

-- Orders: HitPay integration
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_provider TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'unpaid';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_reference TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_amount NUMERIC(10,2);

-- Orders: risk flag
ALTER TABLE orders ADD COLUMN IF NOT EXISTS risk_flag TEXT;

-- Idempotency: unique index on payment_reference (for webhook dedup)
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_payment_reference
  ON orders(payment_reference) WHERE payment_reference IS NOT NULL;

-- Inventory movements: accountability
ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS performed_by UUID REFERENCES profiles(id);
ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS performed_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS previous_stock NUMERIC(12,4);
ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS new_stock NUMERIC(12,4);

-- ============================================================
-- V3: Reconciliation Days
-- ============================================================
CREATE TABLE IF NOT EXISTS reconciliation_days (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL UNIQUE,
  total_expected NUMERIC(10,2) NOT NULL DEFAULT 0,
  total_confirmed NUMERIC(10,2) NOT NULL DEFAULT 0,
  variance NUMERIC(10,2) NOT NULL DEFAULT 0,
  reconciled_by UUID REFERENCES profiles(id),
  reconciled_at TIMESTAMPTZ DEFAULT now(),
  override_reason TEXT,
  override_by UUID REFERENCES profiles(id),
  override_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE reconciliation_days ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin all reconciliation_days" ON reconciliation_days FOR ALL USING (true) WITH CHECK (true);

-- ============================================================
-- Phase 4: System Settings & Governance
-- ============================================================

CREATE TABLE IF NOT EXISTS system_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS settings_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL,
  old_value JSONB,
  new_value JSONB NOT NULL,
  version INTEGER NOT NULL,
  changed_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notification_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE system_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin all system_settings" ON system_settings FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE settings_audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin all settings_audit_log" ON settings_audit_log FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE notification_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin all notification_logs" ON notification_logs FOR ALL USING (true) WITH CHECK (true);

-- ============================================================
-- SETUP NOTES:
-- 1. Create admin user in Supabase Auth (Authentication > Users)
-- 2. Insert profile: INSERT INTO profiles (id, full_name, role) VALUES ('<auth-user-id>', 'Admin Name', 'admin');
-- 3. Create barista user similarly with role 'barista'
-- 4. The on_auth_user_created trigger auto-creates a profile with role 'barista' for new signups
-- 5. For HitPay: set HITPAY_API_KEY, HITPAY_SALT, NEXT_PUBLIC_APP_URL in .env.local
-- 6. For Resend: set RESEND_API_KEY in .env.local
-- ============================================================
