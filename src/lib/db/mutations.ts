import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import type { PaymentMethod, PaymentProvider, PaymentStatus, ProofStatus, OrderStatus } from "@/lib/types";

// ---- Generate Sequential Order Number ----

export async function generateSequentialOrderNumber(): Promise<string> {
  const supabase = await createClient();
  
  try {
    // Get the highest order number
    const { data: lastOrder, error } = await supabase
      .from("orders")
      .select("order_number")
      .not("order_number", "is", null)
      .order("order_number", { ascending: false })
      .limit(1)
      .single();
    
    let nextNumber = 1;
    
    if (!error && lastOrder && lastOrder.order_number) {
      // Extract numeric part from order number (handles formats like "ORD-001", "000001", etc.)
      const numericPart = lastOrder.order_number.match(/\d+/);
      if (numericPart) {
        nextNumber = parseInt(numericPart[0]) + 1;
      }
    }
    
    // Format as 6-digit number with leading zeros
    return nextNumber.toString().padStart(6, '0');
    
  } catch (err) {
    console.warn("Failed to get last order number, starting from 1:", err);
    return "000001";
  }
}

// ---- Insert Order ----

export async function insertOrder(params: {
  source: "fridge" | "cafe";
  status?: OrderStatus;
  payment_method: PaymentMethod;
  payment_proof_url?: string | null;
  payment_proof_status?: ProofStatus;
  payment_confirmed?: boolean;
  order_snapshot_url?: string | null;
  notes?: string | null;
  total_price: number;
  total_cost: number;
  margin: number;
  // V3
  customer_name?: string | null;
  payment_provider?: PaymentProvider;
  payment_status?: PaymentStatus;
  payment_reference?: string | null;
  payment_amount?: number | null;
  risk_flag?: string | null;
}) {
  const supabase = await createClient();
  
  // Generate sequential order number
  const orderNumber = await generateSequentialOrderNumber();
  
  const { data, error } = await supabase
    .from("orders")
    .insert({
      order_number: orderNumber,
      source: params.source,
      status: params.status ?? "new",
      payment_method: params.payment_method,
      payment_proof_url: params.payment_proof_url ?? null,
      payment_proof_status: params.payment_proof_status ?? "none",
      payment_confirmed: params.payment_confirmed ?? false,
      order_snapshot_url: params.order_snapshot_url ?? null,
      notes: params.notes ?? null,
      total_price: params.total_price,
      total_cost: params.total_cost,
      margin: params.margin,
      // V3
      customer_name: params.customer_name ?? null,
      payment_provider: params.payment_provider ?? "manual",
      payment_status: params.payment_status ?? "unpaid",
      payment_reference: params.payment_reference ?? null,
      payment_amount: params.payment_amount ?? null,
      risk_flag: params.risk_flag ?? null,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

// ---- Insert Order Items ----

export async function insertOrderItems(
  items: {
    order_id: string;
    product_id: string;
    qty: number;
    price_at_sale: number;
    cost_at_sale: number;
  }[]
) {
  const supabase = await createClient();
  const { error } = await supabase.from("order_items").insert(items);
  if (error) throw error;
}

// ---- Update Order Status ----

export async function updateOrderStatus(orderId: string, status: string) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("orders")
    .update({ status })
    .eq("id", orderId);
  if (error) throw error;
}

// ---- Confirm Payment (V3: with accountability) ----

export async function confirmPayment(orderId: string, confirmedByUserId?: string) {
  const supabase = await createClient();
  console.log(`[DB] Attempting to confirm order: ${orderId} by user: ${confirmedByUserId}`);
  
  // Standard update object
  const updates: any = {
    payment_confirmed: true,
    payment_proof_status: "confirmed"
  };

  // Try to use V3 accountability columns if they exist
  // If your DB doesn't have these, run: 
  // ALTER TABLE orders ADD COLUMN IF NOT EXISTS confirmed_by UUID;
  // ALTER TABLE orders ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ;
  
  try {
    const { data, error } = await supabase
      .from("orders")
      .update({
        ...updates,
        confirmed_by: confirmedByUserId ?? null,
        confirmed_at: new Date().toISOString(),
      })
      .eq("id", orderId)
      .select("id, payment_confirmed, order_number");

    if (error) {
      // PGRST204 is 'Column not found' - fallback to basic update
      if (error.code === 'PGRST204' || error.message.includes("confirmed_at")) {
        console.warn("[DB] confirmed_at column missing, falling back to basic confirmation.");
        const { data: fallbackData, error: fallbackError } = await supabase
          .from("orders")
          .update(updates)
          .eq("id", orderId)
          .select("id, payment_confirmed, order_number");
          
        if (fallbackError) throw fallbackError;
        if (!fallbackData || fallbackData.length === 0) throw new Error("Order not found or update blocked by RLS.");
        
        return fallbackData[0];
      }
      throw error;
    }
    
    if (!data || data.length === 0) {
      throw new Error("The database refused to save this confirmation. Please check if you have Admin permissions.");
    }

    return data[0];
  } catch (err) {
    console.error(`[DB] confirmPayment error:`, err);
    throw err;
  } finally {
    // Refresh multiple paths to ensure consistency
    try {
      revalidatePath("/");
      revalidatePath("/dashboard");
      revalidatePath("/dashboard/reconciliation");
    } catch (e) {
      console.warn("[DB] Post-confirmation revalidation failed (non-blocking):", e);
    }
  }
}

// ---- Stock validation + deduction ----

export async function validateAndDeductRetailStock(
  productId: string,
  qty: number
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();
  const { data: current, error: fetchError } = await supabase
    .from("retail_stock")
    .select("stock")
    .eq("product_id", productId)
    .single();

  if (fetchError) return { success: false, error: fetchError.message };

  const currentStock = current?.stock ?? 0;
  if (currentStock < qty) {
    return { success: false, error: `Only ${currentStock} available, ${qty} requested` };
  }

  const { error: updateError } = await supabase
    .from("retail_stock")
    .update({ stock: currentStock - qty, updated_at: new Date().toISOString() })
    .eq("product_id", productId);

  if (updateError) return { success: false, error: updateError.message };
  return { success: true };
}

export async function validateAndDeductIngredientStock(
  ingredientId: string,
  qtyToDeduct: number
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();
  const { data: current, error: fetchError } = await supabase
    .from("ingredients")
    .select("stock, name")
    .eq("id", ingredientId)
    .single();

  if (fetchError) return { success: false, error: fetchError.message };

  const currentStock = Number(current?.stock ?? 0);
  if (currentStock < qtyToDeduct) {
    return { success: false, error: `Insufficient ${current?.name}: ${currentStock} available` };
  }

  const { error: updateError } = await supabase
    .from("ingredients")
    .update({ stock: currentStock - qtyToDeduct })
    .eq("id", ingredientId);

  if (updateError) return { success: false, error: updateError.message };
  return { success: true };
}

// ---- Insert Inventory Movement (V3: with accountability + stock snapshot) ----

export async function insertInventoryMovement(params: {
  item_type: "product" | "ingredient";
  item_id: string;
  quantity_delta: number;
  movement_type: "sale" | "restock" | "adjustment" | "spoilage";
  reference_order_id?: string | null;
  notes?: string | null;
  // V3
  performed_by?: string | null;
  previous_stock?: number | null;
  new_stock?: number | null;
}) {
  const supabase = await createClient();
  
  // Standard insert object
  const record: any = {
    item_type: params.item_type,
    item_id: params.item_id,
    quantity_delta: params.quantity_delta,
    movement_type: params.movement_type,
    reference_order_id: params.reference_order_id ?? null,
    notes: params.notes ?? null,
    performed_by: params.performed_by ?? null,
    performed_at: new Date().toISOString(),
  };

  // V3 accountability columns
  // If your DB doesn't have these, run: 
  // ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS previous_stock NUMERIC(12,4);
  // ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS new_stock NUMERIC(12,4);
  
  const { error } = await supabase.from("inventory_movements").insert({
    ...record,
    previous_stock: params.previous_stock ?? null,
    new_stock: params.new_stock ?? null,
  });

  if (error) {
    // PGRST204 is 'Column not found' - fallback to basic insert
    if (error.code === 'PGRST204' || error.message.includes("previous_stock")) {
      console.warn("[DB] previous_stock/new_stock columns missing in inventory_movements, falling back.");
      const { error: fallbackError } = await supabase
        .from("inventory_movements")
        .insert(record);
      if (fallbackError) throw fallbackError;
      return;
    }
    throw error;
  }
}

// ---- Adjust Stock ----

export async function adjustRetailStock(productId: string, newStock: number) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("retail_stock")
    .update({ stock: newStock, updated_at: new Date().toISOString() })
    .eq("product_id", productId);
  if (error) throw error;
}

export async function adjustIngredientStock(ingredientId: string, newStock: number) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("ingredients")
    .update({ stock: newStock })
    .eq("id", ingredientId);
  if (error) throw error;
}

// ---- Admin: Product CRUD ----

export async function createProduct(params: {
  name: string;
  type: "cafe" | "retail";
  selling_price: number;
  base_cost?: number | null;
  image_url?: string | null;
  low_stock_threshold?: number | null;
  active?: boolean;
}) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("products")
    .insert({
      name: params.name,
      type: params.type,
      selling_price: params.selling_price,
      base_cost: params.base_cost ?? null,
      image_url: params.image_url ?? null,
      low_stock_threshold: params.low_stock_threshold ?? null,
      active: params.active ?? true,
    })
    .select()
    .single();

  if (error) throw error;

  // Create retail_stock row if retail
  if (params.type === "retail") {
    const { error: stockError } = await supabase
      .from("retail_stock")
      .insert({ product_id: data.id, stock: 0 });
    if (stockError) throw stockError;
  }

  return data;
}

export async function updateProduct(
  id: string,
  params: {
    name?: string;
    selling_price?: number;
    base_cost?: number | null;
    image_url?: string | null;
    low_stock_threshold?: number | null;
    active?: boolean;
  }
) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("products")
    .update(params)
    .eq("id", id);
  if (error) throw error;
}

// ---- Admin: Ingredient CRUD ----

export async function createIngredient(params: {
  name: string;
  unit: string;
  unit_cost: number;
  stock?: number;
  low_stock_threshold?: number;
}) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ingredients")
    .insert({
      name: params.name,
      unit: params.unit,
      unit_cost: params.unit_cost,
      stock: params.stock ?? 0,
      low_stock_threshold: params.low_stock_threshold ?? 0,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function updateIngredient(
  id: string,
  params: {
    name?: string;
    unit?: string;
    unit_cost?: number;
    low_stock_threshold?: number;
    stock?: number;
  }
) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("ingredients")
    .update(params)
    .eq("id", id);
  if (error) throw error;
}

// ---- Admin: Recipe CRUD ----

export async function saveRecipes(
  productId: string,
  recipes: { ingredient_id: string; qty_required: number }[]
) {
  const supabase = await createClient();

  // Delete existing recipes for this product
  const { error: deleteError } = await supabase
    .from("recipes")
    .delete()
    .eq("product_id", productId);
  if (deleteError) throw deleteError;

  // Insert new recipes
  if (recipes.length > 0) {
    const { error: insertError } = await supabase.from("recipes").insert(
      recipes.map((r) => ({
        product_id: productId,
        ingredient_id: r.ingredient_id,
        qty_required: r.qty_required,
      }))
    );
    if (insertError) throw insertError;
  }
}

// ---- Upload to storage ----

export async function uploadToStorage(
  bucket: string,
  file: File
): Promise<string> {
  // Use service role key to ensure we have permission to upload
  const serviceClient = (await import("@supabase/supabase-js")).createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  
  const ext = file.name.split(".").pop() ?? "jpg";
  const fileName = `${crypto.randomUUID()}.${ext}`;

  const { error } = await serviceClient.storage.from(bucket).upload(fileName, file);
  if (error) {
    console.error(`[Storage] Upload error for ${fileName}:`, error);
    throw error;
  }

  const { data: urlData } = serviceClient.storage.from(bucket).getPublicUrl(fileName);
  return urlData.publicUrl;
}
