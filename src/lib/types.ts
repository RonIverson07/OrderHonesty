/* ============================================================
   LaBrew V3 — Type Definitions
   ============================================================ */

// ---- Enums ----

export type ProductType = "cafe" | "retail";
export type OrderSource = "fridge" | "cafe";
export type OrderStatus = "new" | "preparing" | "ready" | "completed" | "cancelled";
export type PaymentMethod = "cash" | "gcash" | "bank_transfer" | "hitpay";
export type ProofStatus = "none" | "uploaded" | "confirmed" | "flagged";
export type MovementType = "sale" | "restock" | "adjustment" | "spoilage";
export type UserRole = "admin" | "barista";
export type PaymentProvider = "manual" | "hitpay";
export type PaymentStatus = "unpaid" | "pending" | "paid" | "failed" | "expired";

// ---- Row Types ----

export interface Profile {
  id: string;
  full_name: string;
  role: UserRole;
  created_at: string;
}

export interface Product {
  id: string;
  name: string;
  type: ProductType;
  selling_price: number;
  base_cost: number | null;
  image_url: string | null;
  active: boolean;
  low_stock_threshold: number | null;
  created_at: string;
}

export interface Ingredient {
  id: string;
  name: string;
  unit: string;
  unit_cost: number;
  stock: number;
  low_stock_threshold: number;
  created_at: string;
}

export interface Recipe {
  id: string;
  product_id: string;
  ingredient_id: string;
  qty_required: number;
}

export interface RetailStock {
  id: string;
  product_id: string;
  stock: number;
  updated_at: string;
}

export interface Order {
  id: string;
  order_number: string | null;
  source: OrderSource;
  status: OrderStatus;
  payment_method: PaymentMethod;
  payment_proof_url: string | null;
  payment_proof_status: ProofStatus;
  payment_confirmed: boolean;
  order_snapshot_url: string | null;
  notes: string | null;
  total_price: number;
  total_cost: number;
  margin: number;
  created_at: string;
  preparing_at: string | null;
  ready_at: string | null;
  completed_at: string | null;
  // V3: accountability
  confirmed_by: string | null;
  confirmed_at: string | null;
  // V3: identity
  customer_name: string | null;
  // V3: HitPay
  payment_provider: PaymentProvider;
  payment_status: PaymentStatus;
  payment_reference: string | null;
  payment_amount: number | null;
  // V3: risk
  risk_flag: string | null;
}

export interface OrderItem {
  id: string;
  order_id: string;
  product_id: string;
  qty: number;
  price_at_sale: number;
  cost_at_sale: number;
}

export interface InventoryMovement {
  id: string;
  item_type: string;
  item_id: string;
  quantity_delta: number;
  movement_type: MovementType;
  reference_order_id: string | null;
  notes: string | null;
  created_at: string;
  // V3: accountability
  performed_by: string | null;
  performed_at: string | null;
  previous_stock: number | null;
  new_stock: number | null;
}

export interface ReconciliationDay {
  id: string;
  date: string;
  total_expected: number;
  total_confirmed: number;
  variance: number;
  reconciled_by: string | null;
  reconciled_at: string | null;
  notes: string | null;
  created_at: string;
}

// ==== Phase 4: Standardization ====

export interface SystemSetting {
  key: string;
  value: any;
  version: number;
  updated_at: string;
}

export interface SettingsAuditLog {
  id: string;
  key: string;
  old_value: any;
  new_value: any;
  version: number;
  changed_by: string | null;
  created_at: string;
}

export interface NotificationLog {
  id: string;
  type: string;
  status: "sent" | "failed";
  error_message: string | null;
  created_at: string;
}

// ==== Composite / Enriched Types ====

export interface ProductWithStock extends Product {
  retail_stock?: RetailStock | null;
}

export interface RecipeWithIngredient extends Recipe {
  ingredients: Ingredient;
}

export interface OrderWithItems extends Order {
  order_items: (OrderItem & { products: Product })[];
}

export interface CafeProductAvailability extends Product {
  available: boolean;
  unavailable_reason?: string;
  max_servings?: number;
}

// ---- Cart Types ----

export interface CartItem {
  product: Product;
  qty: number;
}
