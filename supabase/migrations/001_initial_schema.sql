-- ==========================================================
-- THE BEST POS - Supabase PostgreSQL Initial Migration
-- ==========================================================

-- 1. ENUMS
DO $$ BEGIN
  CREATE TYPE product_type AS ENUM ('phone', 'accessory');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE unit_status AS ENUM ('IN_STORE', 'IN_SHOP', 'SOLD', 'DAMAGED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE stock_location AS ENUM ('STORE', 'SHOP');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE movement_type AS ENUM ('PURCHASE', 'TRANSFER', 'SALE', 'RETURN', 'ADJUSTMENT', 'DAMAGE');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE payment_method AS ENUM ('CASH', 'LIPA_NAMBA', 'BANK', 'MPESA', 'MIXX', 'AIRTEL');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('owner', 'seller');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE sale_status AS ENUM ('PAID', 'PARTIAL', 'VOID');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE expense_category AS ENUM ('RENT', 'ELECTRICITY', 'SALARIES', 'TRANSPORT', 'FOOD', 'OTHER');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE stock_take_status AS ENUM ('SUBMITTED', 'APPROVED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 2. USER PROFILES
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  phone text UNIQUE NOT NULL,
  full_name text NOT NULL,
  role user_role NOT NULL DEFAULT 'seller',
  is_active boolean NOT NULL DEFAULT true,
  pin_hash text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 3. STORE SETTINGS
CREATE TABLE IF NOT EXISTS public.settings (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  shop_name text NOT NULL DEFAULT 'THE BEST',
  shop_phone text DEFAULT '',
  shop_address text DEFAULT '',
  receipt_footer text DEFAULT 'Asante kwa kununua THE BEST',
  sms_daily boolean NOT NULL DEFAULT true,
  sms_purchase boolean NOT NULL DEFAULT false,
  sms_debt_payment boolean NOT NULL DEFAULT true,
  sms_reminders boolean NOT NULL DEFAULT true,
  daily_time text NOT NULL DEFAULT '21:00',
  owner_phone text DEFAULT '',
  default_min_stock int NOT NULL DEFAULT 5,
  printer_width text NOT NULL DEFAULT '80',
  max_discount_pct int NOT NULL DEFAULT 5,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Insert default settings row if not exists
INSERT INTO public.settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- 4. PRODUCTS
CREATE TABLE IF NOT EXISTS public.products (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL,
  detail text NOT NULL DEFAULT '',
  type product_type NOT NULL,
  code text NOT NULL UNIQUE,
  barcode text UNIQUE,
  cost_price bigint NOT NULL DEFAULT 0,
  sell_price bigint NOT NULL,
  min_stock int NOT NULL DEFAULT 5,
  image_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 5. PHONE UNITS (IMEI)
CREATE TABLE IF NOT EXISTS public.inventory_units (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  imei text NOT NULL UNIQUE,
  product_id bigint NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  status unit_status NOT NULL DEFAULT 'IN_STORE',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_units_product_status ON public.inventory_units(product_id, status);

-- 6. STOCK MOVEMENTS (Append-only ledger)
CREATE TABLE IF NOT EXISTS public.stock_movements (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id bigint NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  from_location stock_location,
  to_location stock_location,
  qty int NOT NULL CHECK (qty > 0),
  type movement_type NOT NULL,
  unit_cost bigint,
  ref_type text,
  ref_id bigint,
  user_name text NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_movements_product ON public.stock_movements(product_id);
CREATE INDEX IF NOT EXISTS idx_movements_created ON public.stock_movements(created_at);

-- 7. CUSTOMERS
CREATE TABLE IF NOT EXISTS public.customers (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL,
  phone text,
  area text,
  id_number text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_customers_phone ON public.customers(phone);
CREATE INDEX IF NOT EXISTS idx_customers_name ON public.customers(name);

-- 8. SALES
CREATE TABLE IF NOT EXISTS public.sales (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  receipt_no text NOT NULL UNIQUE,
  user_name text NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  customer_id bigint REFERENCES public.customers(id) ON DELETE SET NULL,
  subtotal bigint NOT NULL,
  discount bigint NOT NULL DEFAULT 0,
  total bigint NOT NULL,
  due_date date,
  status sale_status NOT NULL DEFAULT 'PAID',
  voided_by text,
  void_reason text,
  voided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sales_created ON public.sales(created_at);
CREATE INDEX IF NOT EXISTS idx_sales_customer ON public.sales(customer_id);

-- 9. SALE ITEMS
CREATE TABLE IF NOT EXISTS public.sale_items (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sale_id bigint NOT NULL REFERENCES public.sales(id) ON DELETE CASCADE,
  product_id bigint NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  name text NOT NULL,
  qty int NOT NULL CHECK (qty > 0),
  unit_price bigint NOT NULL,
  unit_cost bigint NOT NULL DEFAULT 0,
  imei text,
  returned_qty int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON public.sale_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_product ON public.sale_items(product_id);

-- 10. PAYMENTS
CREATE TABLE IF NOT EXISTS public.payments (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sale_id bigint REFERENCES public.sales(id) ON DELETE RESTRICT,
  customer_id bigint REFERENCES public.customers(id) ON DELETE SET NULL,
  method payment_method NOT NULL,
  amount bigint NOT NULL,
  kind text NOT NULL CHECK (kind IN ('SALE', 'DEBT', 'REFUND')),
  user_name text,
  reference text,
  idempotency_key text UNIQUE,
  paid_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payments_sale ON public.payments(sale_id);
CREATE INDEX IF NOT EXISTS idx_payments_customer ON public.payments(customer_id);
CREATE INDEX IF NOT EXISTS idx_payments_paid_at ON public.payments(paid_at);

-- 11. SALE RETURNS
CREATE TABLE IF NOT EXISTS public.sale_returns (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sale_id bigint NOT NULL REFERENCES public.sales(id) ON DELETE RESTRICT,
  by_user text NOT NULL,
  reason text NOT NULL,
  condition text NOT NULL CHECK (condition IN ('RESTOCK', 'DAMAGED')),
  value bigint NOT NULL,
  refund_amount bigint NOT NULL DEFAULT 0,
  items jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_returns_sale ON public.sale_returns(sale_id);

-- 12. TRANSFERS (Store -> Shop)
CREATE TABLE IF NOT EXISTS public.transfers (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_name text NOT NULL,
  note text DEFAULT '',
  items jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 13. SUPPLIERS
CREATE TABLE IF NOT EXISTS public.suppliers (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL UNIQUE,
  phone text DEFAULT '',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 14. PURCHASES (Receiving goods from suppliers)
CREATE TABLE IF NOT EXISTS public.purchases (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  supplier_id bigint NOT NULL REFERENCES public.suppliers(id) ON DELETE RESTRICT,
  location stock_location NOT NULL DEFAULT 'STORE',
  invoice_no text NOT NULL,
  purchase_date date NOT NULL,
  total bigint NOT NULL,
  user_name text NOT NULL,
  lines jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_purchases_supplier ON public.purchases(supplier_id);
CREATE INDEX IF NOT EXISTS idx_purchases_date ON public.purchases(purchase_date);

-- 15. SUPPLIER PAYMENTS
CREATE TABLE IF NOT EXISTS public.supplier_payments (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  supplier_id bigint NOT NULL REFERENCES public.suppliers(id) ON DELETE RESTRICT,
  purchase_id bigint REFERENCES public.purchases(id) ON DELETE SET NULL,
  amount bigint NOT NULL,
  method payment_method NOT NULL,
  user_name text NOT NULL,
  paid_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_supplier_payments_supplier ON public.supplier_payments(supplier_id);

-- 16. EXPENSES
CREATE TABLE IF NOT EXISTS public.expenses (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  category expense_category NOT NULL,
  amount bigint NOT NULL CHECK (amount > 0),
  description text DEFAULT '',
  method payment_method NOT NULL,
  spent_on date NOT NULL,
  user_name text NOT NULL,
  idempotency_key text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_expenses_spent_on ON public.expenses(spent_on);

-- 17. CASH CLOSINGS (End-of-day register reconciliation)
CREATE TABLE IF NOT EXISTS public.cash_closings (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  closing_date date NOT NULL UNIQUE,
  user_name text NOT NULL,
  cash_sales bigint NOT NULL DEFAULT 0,
  cash_debt_payments bigint NOT NULL DEFAULT 0,
  cash_refunds bigint NOT NULL DEFAULT 0,
  cash_expenses bigint NOT NULL DEFAULT 0,
  expected_cash bigint NOT NULL,
  counted_cash bigint NOT NULL,
  difference bigint NOT NULL,
  note text DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 18. STOCK TAKES
CREATE TABLE IF NOT EXISTS public.stock_takes (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  location stock_location NOT NULL,
  status stock_take_status NOT NULL DEFAULT 'SUBMITTED',
  created_by text NOT NULL,
  approved_by text,
  approved_at timestamptz,
  lines jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 19. AUDIT LOGS
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_name text NOT NULL,
  action text NOT NULL,
  subject_id text,
  detail text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_created ON public.audit_logs(created_at);

-- 20. SMS LOGS
CREATE TABLE IF NOT EXISTS public.sms_logs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  to_phone text NOT NULL,
  body text NOT NULL,
  type text NOT NULL,
  status text NOT NULL,
  dedupe_key text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ==========================================================
-- VIEW: PRODUCTS WITH DYNAMIC STOCK BALANCES
-- ==========================================================
CREATE OR REPLACE VIEW public.products_view AS
SELECT
  p.id,
  p.name,
  p.detail,
  p.type,
  p.code,
  p.barcode,
  p.cost_price,
  p.sell_price,
  p.min_stock,
  p.image_url,
  p.created_at,
  p.updated_at,
  -- Store Quantity
  CASE
    WHEN p.type = 'phone' THEN
      COALESCE((SELECT count(*)::int FROM public.inventory_units u WHERE u.product_id = p.id AND u.status = 'IN_STORE'), 0)
    ELSE
      COALESCE((
        SELECT
          COALESCE(SUM(CASE WHEN m.to_location = 'STORE' THEN m.qty ELSE 0 END), 0) -
          COALESCE(SUM(CASE WHEN m.from_location = 'STORE' THEN m.qty ELSE 0 END), 0)
        FROM public.stock_movements m
        WHERE m.product_id = p.id
      ), 0)::int
  END AS store_qty,
  -- Shop Quantity
  CASE
    WHEN p.type = 'phone' THEN
      COALESCE((SELECT count(*)::int FROM public.inventory_units u WHERE u.product_id = p.id AND u.status = 'IN_SHOP'), 0)
    ELSE
      COALESCE((
        SELECT
          COALESCE(SUM(CASE WHEN m.to_location = 'SHOP' THEN m.qty ELSE 0 END), 0) -
          COALESCE(SUM(CASE WHEN m.from_location = 'SHOP' THEN m.qty ELSE 0 END), 0)
        FROM public.stock_movements m
        WHERE m.product_id = p.id
      ), 0)::int
  END AS shop_qty,
  -- Store IMEIs
  CASE
    WHEN p.type = 'phone' THEN
      COALESCE((SELECT jsonb_agg(u.imei ORDER BY u.id) FROM public.inventory_units u WHERE u.product_id = p.id AND u.status = 'IN_STORE'), '[]'::jsonb)
    ELSE '[]'::jsonb
  END AS store_imeis,
  -- Shop IMEIs
  CASE
    WHEN p.type = 'phone' THEN
      COALESCE((SELECT jsonb_agg(u.imei ORDER BY u.id) FROM public.inventory_units u WHERE u.product_id = p.id AND u.status = 'IN_SHOP'), '[]'::jsonb)
    ELSE '[]'::jsonb
  END AS shop_imeis
FROM public.products p;

-- ==========================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ==========================================================

-- Enable RLS on all tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sale_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sale_returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_closings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_takes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sms_logs ENABLE ROW LEVEL SECURITY;

-- Helper functions
CREATE OR REPLACE FUNCTION public.is_owner()
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'owner' AND is_active = true
  );
$$;

-- PROFILES policies
CREATE POLICY "Users can read profiles" ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE TO authenticated USING (id = auth.uid());
CREATE POLICY "Owners can manage all profiles" ON public.profiles FOR ALL TO authenticated USING (public.is_owner());

-- SETTINGS policies
CREATE POLICY "Users can read settings" ON public.settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "Owners can update settings" ON public.settings FOR UPDATE TO authenticated USING (public.is_owner());

-- PRODUCTS policies
CREATE POLICY "Users can read products" ON public.products FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can create products" ON public.products FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Owners can update products" ON public.products FOR UPDATE TO authenticated USING (public.is_owner());
CREATE POLICY "Owners can delete products" ON public.products FOR DELETE TO authenticated USING (public.is_owner());

-- INVENTORY_UNITS policies
CREATE POLICY "Users can read units" ON public.inventory_units FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users can insert/update units" ON public.inventory_units FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- STOCK_MOVEMENTS policies
CREATE POLICY "Users can read movements" ON public.stock_movements FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users can insert movements" ON public.stock_movements FOR INSERT TO authenticated WITH CHECK (true);

-- CUSTOMERS policies
CREATE POLICY "Users can read customers" ON public.customers FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users can insert customers" ON public.customers FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Users can update customers" ON public.customers FOR UPDATE TO authenticated USING (true);

-- SALES, ITEMS, PAYMENTS policies
CREATE POLICY "Users can read sales" ON public.sales FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users can insert sales" ON public.sales FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Owners can update sales" ON public.sales FOR UPDATE TO authenticated USING (public.is_owner());

CREATE POLICY "Users can read sale items" ON public.sale_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users can insert sale items" ON public.sale_items FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Users can update sale items" ON public.sale_items FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Users can read payments" ON public.payments FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users can insert payments" ON public.payments FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Users can manage returns" ON public.sale_returns FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Users can manage transfers" ON public.transfers FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Users can manage suppliers" ON public.suppliers FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Users can manage purchases" ON public.purchases FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Users can manage supplier payments" ON public.supplier_payments FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Users can manage expenses" ON public.expenses FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Users can manage closings" ON public.cash_closings FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Users can manage stock takes" ON public.stock_takes FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Users can read/insert audit" ON public.audit_logs FOR ALL TO authenticated USING (public.is_owner() OR auth.uid() IS NOT NULL) WITH CHECK (true);
CREATE POLICY "Users can read/insert sms" ON public.sms_logs FOR ALL TO authenticated USING (true) WITH CHECK (true);

