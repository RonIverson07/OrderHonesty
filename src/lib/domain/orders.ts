"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import {
  insertOrder,
  insertOrderItems,
  insertInventoryMovement,
  adjustRetailStock,
  adjustIngredientStock,
  confirmPayment,
  createProduct,
  updateProduct,
  createIngredient,
  updateIngredient,
  saveRecipes,
  uploadToStorage,
} from "@/lib/db/mutations";
import { getRecipesForProducts } from "@/lib/db/queries";
import { computeUnitCost, computeOrderTotals } from "@/lib/domain/costing";
import { processStockDeduction } from "@/lib/domain/inventory";
import { sendNewOrderAlert } from "@/lib/domain/notifications";
import { requireRole, getCurrentUserId, checkRole } from "@/lib/supabase/auth";
import type {
  CartItem,
  PaymentMethod,
  OrderSource,
  Product,
  RecipeWithIngredient,
} from "@/lib/types";

// ---- Validation Schemas ----

const OrderItemSchema = z.object({
  productId: z.string(),
  qty: z.number().int().positive(),
});

const SubmitOrderSchema = z.object({
  items: z.array(OrderItemSchema).min(1),
  source: z.enum(["fridge", "cafe"]),
  paymentMethod: z.enum(["cash", "gcash", "qr_code", "bank_transfer", "hitpay"]),
  paymentProofUrl: z.string().url().nullable().optional(),
  orderSnapshotUrl: z.string().url().nullable().optional(),
  notes: z.string().nullable().optional(),
  // V3
  customerName: z.string().max(100).nullable().optional(),
});

export type SubmitOrderInput = z.infer<typeof SubmitOrderSchema>;
export type SubmitOrderResult = {
  success: boolean;
  orderId?: string;
  orderNumber?: string;
  error?: string;
};

// ---- Submit Order (public) ----

export async function adminUploadFile(formData: FormData): Promise<{ success: boolean; url?: string; error?: string }> {
  try {
    const file = formData.get("file") as File;
    const bucket = formData.get("bucket") as string;
    if (!file || !bucket) return { success: false, error: "Missing file or bucket" };
    
    const url = await uploadToStorage(bucket, file);
    return { success: true, url };
  } catch (err: any) {
    return { success: false, error: err.message || "Upload failed" };
  }
}

// ---- Risk Flag Detection ----

function detectRiskFlag(
  source: string,
  paymentMethod: string,
  totalPrice: number,
  items: { qty: number }[],
  hasProof: boolean
): string | null {
  const reasons: string[] = [];

  // Fridge + no proof + high value
  if (source === "fridge" && !hasProof && totalPrice >= 500) {
    reasons.push("High-value fridge order without payment proof");
  }

  // Abnormal quantity
  for (const item of items) {
    if (item.qty >= 10) {
      reasons.push(`Abnormal quantity: ${item.qty} units`);
      break;
    }
  }

  return reasons.length > 0 ? reasons.join("; ") : null;
}

// ---- Submit Order (public) ----

export async function submitOrder(input: SubmitOrderInput): Promise<SubmitOrderResult> {
  try {
    const parsed = SubmitOrderSchema.parse(input);
    const supabase = await createClient();
    const productIds = parsed.items.map((i) => i.productId);

    const { data: products, error: productError } = await supabase
      .from("products")
      .select("*")
      .in("id", productIds);

    if (productError) throw productError;
    if (!products || products.length !== productIds.length) {
      return { success: false, error: "One or more products not found" };
    }

    // Check all products are active
    for (const p of products) {
      if (!p.active) {
        return { success: false, error: `${p.name} is no longer available` };
      }
    }

    const productMap = new Map(products.map((p: Product) => [p.id, p]));
    const cartItems: CartItem[] = parsed.items.map((item) => ({
      product: productMap.get(item.productId)!,
      qty: item.qty,
    }));

    // === Pre-deduction stock validation ===
    // Retail: check retail_stock
    for (const item of cartItems) {
      if (item.product.type === "retail") {
        const { data: stockRow } = await supabase
          .from("retail_stock")
          .select("stock")
          .eq("product_id", item.product.id)
          .single();
        const available = stockRow?.stock ?? 0;
        if (available < item.qty) {
          return { success: false, error: `${item.product.name}: only ${available} in stock (requested ${item.qty})` };
        }
      }
    }

    // Café: check ingredient sufficiency
    const cafeProductIds = cartItems
      .filter((c) => c.product.type === "cafe")
      .map((c) => c.product.id);

    let recipes: RecipeWithIngredient[] = [];
    if (cafeProductIds.length > 0) {
      recipes = await getRecipesForProducts(cafeProductIds);

      const ingredientNeeds = new Map<string, { name: string; needed: number }>();
      for (const item of cartItems) {
        if (item.product.type !== "cafe") continue;
        const myRecipes = recipes.filter((r) => r.product_id === item.product.id);
        for (const recipe of myRecipes) {
          const existing = ingredientNeeds.get(recipe.ingredient_id) ?? { name: recipe.ingredients.name, needed: 0 };
          existing.needed += recipe.qty_required * item.qty;
          ingredientNeeds.set(recipe.ingredient_id, existing);
        }
      }

      for (const [ingId, need] of ingredientNeeds) {
        const { data: ingRow } = await supabase
          .from("ingredients")
          .select("stock")
          .eq("id", ingId)
          .single();
        const available = Number(ingRow?.stock ?? 0);
        if (available < need.needed) {
          return { success: false, error: `Insufficient ${need.name}: ${available} available, ${need.needed} needed` };
        }
      }
    }

    const itemsWithCost = cartItems.map((c) => {
      let unitCost = 0;
      try {
        unitCost = computeUnitCost(c.product, recipes);
      } catch (e) {
        console.warn(`Cost calculation failed for ${c.product.name}`, e);
      }
      return { product: c.product, qty: c.qty, unitCost };
    });

    const { totalPrice, totalCost, margin } = computeOrderTotals(itemsWithCost);

    const riskFlag = detectRiskFlag(
      parsed.source,
      parsed.paymentMethod,
      totalPrice,
      parsed.items,
      !!parsed.paymentProofUrl
    );

    const order = await insertOrder({
      source: parsed.source as OrderSource,
      status: parsed.source === "fridge" ? "completed" : "new",
      payment_method: parsed.paymentMethod as PaymentMethod,
      payment_proof_url: parsed.paymentProofUrl ?? null,
      payment_proof_status: parsed.paymentProofUrl ? "uploaded" : "none",
      payment_confirmed: false,
      order_snapshot_url: parsed.orderSnapshotUrl ?? null,
      notes: parsed.notes ?? null,
      total_price: totalPrice,
      total_cost: totalCost || 0,
      margin: margin || 0,
      customer_name: parsed.customerName ?? null,
      risk_flag: riskFlag,
    });

    try {
      await insertOrderItems(
        itemsWithCost.map((item) => ({
          order_id: order.id,
          product_id: item.product.id,
          qty: item.qty,
          price_at_sale: item.product.selling_price,
          cost_at_sale: item.unitCost,
        }))
      );
    } catch (e) {
      console.error("Failed to insert order items:", e);
    }

    try {
      await processStockDeduction(cartItems, recipes, order.id);
    } catch (e) {
      console.warn("Stock deduction failed (non-blocking):", e);
    }

    try {
      const itemsList = cartItems.map(item => `${item.qty}x ${item.product.name}`).join(", ");
      await sendNewOrderAlert(order.id, order.order_number, totalPrice, order.customer_name, order.order_snapshot_url, itemsList);
    } catch (e) {
      console.warn("Alert failed (non-blocking):", e);
    }

    return { success: true, orderId: order.id, orderNumber: order.order_number };
  } catch (err: any) {
    console.error("[submitOrder] CRITICAL ERROR DETAILS:", JSON.stringify(err, null, 2));
    return { success: false, error: err.message || "Internal Server Error" };
  }
}

// ---- Update Status (admin/barista) ----

export async function updateStatus(
  orderId: string,
  status: "new" | "preparing" | "ready" | "completed" | "cancelled"
): Promise<{ success: boolean; error?: string }> {
  try {
    await requireRole("admin", "barista");
    const supabase = await createClient();
    const { error } = await supabase.from("orders").update({ status }).eq("id", orderId);
    if (error) throw error;
    revalidatePath("/dashboard/reconciliation");
    revalidatePath("/barista");
    return { success: true };
  } catch (err) {
    console.error("[updateStatus]", err);
    return { success: false, error: err instanceof Error ? err.message : "Unauthorized" };
  }
}

// ---- Payment Proof Status (admin) ----

export async function updatePaymentProofStatus(
  orderId: string,
  proofStatus: "confirmed" | "flagged"
): Promise<{ success: boolean; error?: string }> {
  try {
    const userId = await getCurrentUserId();
    const isAuthorized = await checkRole("admin");
    
    if (!isAuthorized) {
      return { success: false, error: "Unauthorized: Admin access required." };
    }

    const supabase = await createClient();
    
    // Attempt update with accountability fields
    const fullUpdate: any = {
      payment_proof_status: proofStatus,
      payment_confirmed: proofStatus === "confirmed",
      confirmed_by: proofStatus === "confirmed" ? userId : null,
      confirmed_at: proofStatus === "confirmed" ? new Date().toISOString() : null,
    };

    const { error } = await supabase
      .from("orders")
      .update(fullUpdate)
      .eq("id", orderId);

    if (error) {
      // PGRST204 is 'Column not found' - try basic update
      if (error.code === 'PGRST204' || error.message.includes("confirmed_at")) {
        console.warn("[DB] confirmed_at column missing in updatePaymentProofStatus, using basic update.");
        const { error: fallbackError } = await supabase
          .from("orders")
          .update({
            payment_proof_status: proofStatus,
            payment_confirmed: proofStatus === "confirmed",
          })
          .eq("id", orderId);
        if (fallbackError) throw fallbackError;
      } else {
        throw error;
      }
    }

    revalidatePath("/dashboard/reconciliation");
    return { success: true };
  } catch (err: any) {
    console.error("[updatePaymentProofStatus] server error:", err);
    let errorMsg = "Database update failed";
    if (err?.message) errorMsg = err.message;
    else if (err?.error_description) errorMsg = err.error_description;
    else if (typeof err === "object") errorMsg = JSON.stringify(err);
    else if (err) errorMsg = String(err);
    return { success: false, error: errorMsg };
  }
}

// ---- Confirm Payment (admin, V3: accountability) ----

export async function confirmOrderPayment(orderId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const userId = await getCurrentUserId();
    const isAuthorized = await checkRole("admin");
    
    if (!isAuthorized) {
      return { success: false, error: "Unauthorized: Admin access required." };
    }
    
    // Check if we are in demo mode via the environment
    const isActuallyDemo = !process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL.includes("demo");
    
    if (!userId && !isActuallyDemo) {
       return { success: false, error: "Session expired. Please log in again." };
    }

    await confirmPayment(orderId, userId);
    revalidatePath("/dashboard/reconciliation");
    return { success: true };
  } catch (err: any) {
    console.error("[confirmOrderPayment] server error:", err);
    let errorMsg = "Database confirmation failed";
    if (err?.message) errorMsg = err.message;
    else if (err?.error_description) errorMsg = err.error_description;
    else if (typeof err === "object") errorMsg = JSON.stringify(err);
    else if (err) errorMsg = String(err);
    return { success: false, error: errorMsg };
  }
}

// ---- Mark Day as Reconciled (admin, V3: creates reconciliation_days record) ----

export async function markDayReconciled(
  dateStr: string,
  overrideReason?: string
): Promise<{ success: boolean; count: number; error?: string }> {
  try {
    const userId = await getCurrentUserId();
    const isAuthorized = await checkRole("admin");
    
    if (!isAuthorized) {
      return { success: false, count: 0, error: "Unauthorized: Admin access required." };
    }

    const supabase = await createClient();

    // V3: Prevent duplicate reconciliation
    const { data: existing } = await supabase
      .from("reconciliation_days")
      .select("id")
      .eq("date", dateStr)
      .single();

    if (existing) {
      return { success: false, count: 0, error: "This date has already been reconciled" };
    }

    const startOfDay = new Date(dateStr);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(dateStr);
    endOfDay.setHours(23, 59, 59, 999);

    // Fetch all orders for the day to compute totals
    const { data: allOrders } = await supabase
      .from("orders")
      .select("total_price, payment_confirmed")
      .gte("created_at", startOfDay.toISOString())
      .lte("created_at", endOfDay.toISOString());

    const totalExpected = (allOrders ?? []).reduce((s, o) => s + Number(o.total_price), 0);
    const totalConfirmed = (allOrders ?? []).filter((o) => o.payment_confirmed).reduce((s, o) => s + Number(o.total_price), 0);

    // Batch confirm unconfirmed orders
    const { data, error } = await supabase
      .from("orders")
      .update({
        payment_confirmed: true,
        payment_proof_status: "confirmed",
        confirmed_by: userId,
        confirmed_at: new Date().toISOString(),
      })
      .gte("created_at", startOfDay.toISOString())
      .lte("created_at", endOfDay.toISOString())
      .eq("payment_confirmed", false)
      .select("id");

    if (error) throw error;

    // V3: Insert reconciliation_days record
    const { error: reconcError } = await supabase.from("reconciliation_days").insert({
      date: dateStr,
      total_expected: totalExpected,
      total_confirmed: totalConfirmed + (data ?? []).reduce(() => 0, 0),
      variance: totalExpected - totalConfirmed,
      reconciled_by: userId,
      reconciled_at: new Date().toISOString(),
      override_reason: overrideReason ?? null,
      override_by: overrideReason ? userId : null,
      override_at: overrideReason ? new Date().toISOString() : null,
    });

    if (reconcError) console.error("[markDayReconciled] reconciliation_days insert:", reconcError);

    return { success: true, count: data?.length ?? 0 };
  } catch (err) {
    return { success: false, count: 0, error: err instanceof Error ? err.message : "Error" };
  }
}

// ---- Save Inventory Check (admin, V3: with performed_by + stock snapshots) ----

// ---- Save Inventory Check (admin, V3: with performed_by + stock snapshots) ----

export async function saveInventoryCheck(
  items: { productId: string; productName: string; systemStock: number; actualCount: number }[]
): Promise<{ success: boolean; adjusted: number; totalVariance: number; error?: string }> {
  try {
    const userId = await getCurrentUserId();
    const isAuthorized = await checkRole("admin");
    if (!isAuthorized) {
      return { success: false, adjusted: 0, totalVariance: 0, error: "Unauthorized: Admin access required." };
    }

    let adjusted = 0;
    let totalVariance = 0;

    for (const item of items) {
      const delta = item.actualCount - item.systemStock;
      if (delta === 0) continue;

      totalVariance += delta;
      adjusted++;

      await adjustRetailStock(item.productId, item.actualCount);

      await insertInventoryMovement({
        item_type: "product",
        item_id: item.productId,
        quantity_delta: delta,
        movement_type: "adjustment",
        notes: `Inventory check: system=${item.systemStock}, actual=${item.actualCount}, variance=${delta > 0 ? "+" : ""}${delta} (${item.productName})`,
        performed_by: userId,
        previous_stock: item.systemStock,
        new_stock: item.actualCount,
      });
    }

    revalidatePath("/dashboard/reconciliation");
    return { success: true, adjusted, totalVariance };
  } catch (err: any) {
    console.error("[saveInventoryCheck] server error:", err);
    let errorMsg = "Failed to save inventory audit";
    if (err?.message) errorMsg = err.message;
    else if (err?.error_description) errorMsg = err.error_description;
    else if (typeof err === "object") errorMsg = JSON.stringify(err);
    else if (err) errorMsg = String(err);
    return { success: false, adjusted: 0, totalVariance: 0, error: errorMsg };
  }
}

// ---- Save Ingredient Check (admin, V3) ----

export async function saveIngredientCheck(
  items: { ingredientId: string; ingredientName: string; systemStock: number; actualCount: number; unit: string }[]
): Promise<{ success: boolean; adjusted: number; totalVariance: number; error?: string }> {
  try {
    const userId = await getCurrentUserId();
    const isAuthorized = await checkRole("admin");
    if (!isAuthorized) {
      return { success: false, adjusted: 0, totalVariance: 0, error: "Unauthorized: Admin access required." };
    }

    let adjusted = 0;
    let totalVariance = 0;

    for (const item of items) {
      const delta = item.actualCount - item.systemStock;
      if (delta === 0) continue;

      totalVariance += delta;
      adjusted++;

      await adjustIngredientStock(item.ingredientId, item.actualCount);

      await insertInventoryMovement({
        item_type: "ingredient",
        item_id: item.ingredientId,
        quantity_delta: delta,
        movement_type: "adjustment",
        notes: `Ingredient audit: system=${item.systemStock}${item.unit}, actual=${item.actualCount}${item.unit}, variance=${delta > 0 ? "+" : ""}${delta}${item.unit} (${item.ingredientName})`,
        performed_by: userId,
        previous_stock: item.systemStock,
        new_stock: item.actualCount,
      });
    }

    revalidatePath("/dashboard/reconciliation");
    return { success: true, adjusted, totalVariance };
  } catch (err: any) {
    console.error("[saveIngredientCheck] server error:", err);
    let errorMsg = "Failed to save ingredient audit";
    if (err?.message) errorMsg = err.message;
    else if (err?.error_description) errorMsg = err.error_description;
    else if (typeof err === "object") errorMsg = JSON.stringify(err);
    else if (err) errorMsg = String(err);
    return { success: false, adjusted: 0, totalVariance: 0, error: errorMsg };
  }
}

// ---- Adjust Stock (admin, V3: with performed_by + stock snapshots + required notes) ----

const AdjustStockSchema = z.object({
  itemType: z.enum(["product", "ingredient"]),
  itemId: z.string(),
  newStock: z.number().min(0),
  reason: z.enum(["restock", "adjustment", "spoilage"]),
  notes: z.string().min(1, "Notes are required for stock adjustments"),
});

export type AdjustStockInput = z.infer<typeof AdjustStockSchema>;

export async function adjustStock(input: AdjustStockInput): Promise<{ success: boolean; error?: string }> {
  try {
    const userId = await getCurrentUserId();
    await requireRole("admin");
    const parsed = AdjustStockSchema.parse(input);
    const supabase = await createClient();
    let currentStock = 0;

    if (parsed.itemType === "product") {
      const { data } = await supabase
        .from("retail_stock")
        .select("stock")
        .eq("product_id", parsed.itemId)
        .single();
      currentStock = data?.stock ?? 0;
      await adjustRetailStock(parsed.itemId, parsed.newStock);
    } else {
      const { data } = await supabase
        .from("ingredients")
        .select("stock")
        .eq("id", parsed.itemId)
        .single();
      currentStock = Number(data?.stock ?? 0);
      await adjustIngredientStock(parsed.itemId, parsed.newStock);
    }

    await insertInventoryMovement({
      item_type: parsed.itemType,
      item_id: parsed.itemId,
      quantity_delta: parsed.newStock - currentStock,
      movement_type: parsed.reason,
      notes: parsed.notes,
      performed_by: userId,
      previous_stock: currentStock,
      new_stock: parsed.newStock,
    });

    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Error" };
  }
}

// ---- Expire Pending Payments (admin, V3) ----

export async function expirePendingPayments(): Promise<{ success: boolean; count: number; error?: string }> {
  try {
    await requireRole("admin");
    const supabase = await createClient();

    const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();

    const { data, error } = await supabase
      .from("orders")
      .update({ payment_status: "expired" })
      .eq("payment_status", "pending")
      .lt("created_at", thirtyMinAgo)
      .select("id");

    if (error) throw error;
    return { success: true, count: data?.length ?? 0 };
  } catch (err) {
    return { success: false, count: 0, error: err instanceof Error ? err.message : "Error" };
  }
}

// ---- Admin: Save Product ----

export async function adminSaveProduct(formData: FormData): Promise<{ success: boolean; error?: string }> {
  try {
    await requireRole("admin");

    const id = formData.get("id") as string | null;
    const name = formData.get("name") as string;
    const type = formData.get("type") as "cafe" | "retail";
    const selling_price = parseFloat(formData.get("selling_price") as string) || 0;
    const base_cost = formData.get("base_cost") ? parseFloat(formData.get("base_cost") as string) : null;
    const low_stock_threshold = formData.get("low_stock_threshold")
      ? parseInt(formData.get("low_stock_threshold") as string)
      : null;
    const active = formData.get("active") === "true";
    let image_url = (formData.get("image_url") as string) || null;
    const image_file = formData.get("image_file");

    if (image_file && typeof image_file === "object" && (image_file as any).size > 0) {
      const file = image_file as File;
      try {
        console.log(`[Storage] Uploading ${file.name} to product-images...`);
        const publicUrl = await uploadToStorage("product-images", file);
        image_url = publicUrl;
        console.log(`[Storage] Uploaded: ${image_url}`);
      } catch (err: any) {
        console.error("[Storage] Upload failed:", err);
        return { success: false, error: "Image storage error: " + (err.message || "Unknown error") };
      }
    }

    const initial_stock = formData.get("initial_stock") ? parseInt(formData.get("initial_stock") as string) : 0;
    const finalStock = isNaN(initial_stock) ? 0 : initial_stock;

    if (id) {
      console.log(`[Admin] Updating product: ${id}`);
      await updateProduct(id, { name, selling_price, base_cost, low_stock_threshold, active, image_url });

      const supabase = await createClient();
      await supabase
        .from("retail_stock")
        .upsert(
          { product_id: id, stock: finalStock, updated_at: new Date().toISOString() },
          { onConflict: "product_id" }
        );
    } else {
      console.log(`[Admin] Creating new product: ${name}`);
      const p = await createProduct({ name, type, selling_price, base_cost, low_stock_threshold, active, image_url });

      if (p?.id) {
        const supabase = await createClient();
        await supabase
          .from("retail_stock")
          .upsert(
            { product_id: p.id, stock: finalStock, updated_at: new Date().toISOString() },
            { onConflict: "product_id" }
          );
      }
    }

    // Refresh app views
    try {
      revalidatePath("/");
      revalidatePath("/cafe");
      revalidatePath("/fridge");
      revalidatePath("/dashboard/products");
    } catch (e) {
      console.warn("[Admin] Revalidation failed (non-blocking):", e);
    }

    console.log("[Admin] Save successful!");
    return { success: true };
  } catch (err: any) {
    console.error("[Admin] Critical save error:", err);
    return { success: false, error: err.message || "An unexpected database error occurred" };
  }
}

// ---- Admin: Save Ingredient ----

export async function adminSaveIngredient(formData: FormData): Promise<{ success: boolean; error?: string }> {
  try {
    await requireRole("admin");

    const id = formData.get("id") as string | null;
    const name = formData.get("name") as string;
    const unit = formData.get("unit") as string;
    const unit_cost = parseFloat(formData.get("unit_cost") as string);
    const low_stock_threshold = formData.get("low_stock_threshold")
      ? parseFloat(formData.get("low_stock_threshold") as string)
      : 0;

    const stock = formData.get("stock") ? parseFloat(formData.get("stock") as string) : 0;

    if (id) {
      await updateIngredient(id, { name, unit, unit_cost, low_stock_threshold, stock });
    } else {
      await createIngredient({ name, unit, unit_cost, low_stock_threshold, stock });
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Error" };
  }
}

// ---- Admin: Save Recipes ----

export async function adminSaveRecipes(
  productId: string,
  recipes: { ingredient_id: string; qty_required: number }[]
): Promise<{ success: boolean; error?: string }> {
  try {
    await requireRole("admin");
    await saveRecipes(productId, recipes);
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Error" };
  }
}
// ---- Admin: Toggle Product Status ----
export async function adminToggleProductStatus(id: string, currentStatus: boolean): Promise<{ success: boolean; error?: string }> {
  try {
    await requireRole("admin");
    const supabase = await createClient();
    const { error } = await supabase
      .from("products")
      .update({ active: !currentStatus })
      .eq("id", id);
      
    if (error) throw error;
    
    revalidatePath("/");
    revalidatePath("/cafe");
    revalidatePath("/fridge");
    revalidatePath("/dashboard/products");
    
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || "Error" };
  }
}

// ---- Admin: Delete Product ----
export async function adminDeleteProduct(id: string): Promise<{ success: boolean; error?: string }> {
  try {
    await requireRole("admin");
    const supabase = await createClient();
    
    // 1. Delete associated recipes
    await supabase.from("recipes").delete().eq("product_id", id);
    
    // 2. Delete from retail_stock
    await supabase.from("retail_stock").delete().eq("product_id", id);
    
    // 3. Delete the product
    const { error } = await supabase.from("products").delete().eq("id", id);
    if (error) {
      // If it's a foreign key violation from order_items
      if (error.code === "23503") {
        throw new Error("Cannot delete this product because it has been ordered. Try deactivating it instead.");
      }
      throw error;
    }
    
    revalidatePath("/");
    revalidatePath("/cafe");
    revalidatePath("/fridge");
    revalidatePath("/dashboard/products");
    
    return { success: true };
  } catch (err: any) {
    console.error("[Admin] Delete failed:", err);
    return { success: false, error: err.message || "Error" };
  }
}
// ---- Admin: Delete Ingredient ----
export async function adminDeleteIngredient(id: string): Promise<{ success: boolean; error?: string }> {
  try {
    await requireRole("admin");
    const supabase = await createClient();
    const { error } = await supabase.from("ingredients").delete().eq("id", id);
    if (error) {
      if (error.code === "23503") {
        throw new Error("Cannot delete this ingredient because it is part of a recipe or order. Try updating its details instead.");
      }
      throw error;
    }
    
    revalidatePath("/");
    revalidatePath("/cafe");
    revalidatePath("/fridge");
    revalidatePath("/dashboard/ingredients");
    revalidatePath("/dashboard/products");
    
    return { success: true };
  } catch (err: any) {
    console.error("[Admin] Delete ingredient failed:", err);
    return { success: false, error: err.message || "Error" };
  }
}

// ---- Admin: Delete Order ----
export async function adminDeleteOrder(orderId: string): Promise<{ success: boolean; error?: string }> {
  try {
    await requireRole("admin");
    const supabase = await createClient();
    
    // First safely delete any linked inventory movements
    await supabase.from("inventory_movements").delete().eq("reference_order_id", orderId);
    
    // First safely delete order items
    await supabase.from("order_items").delete().eq("order_id", orderId);
    
    // Then delete the actual order record
    const { error } = await supabase.from("orders").delete().eq("id", orderId);
    
    if (error) {
       console.error("[Delete Order] foreign key or db error:", error);
       throw error;
    }
    
    revalidatePath("/dashboard");
    revalidatePath("/dashboard/history");
    revalidatePath("/dashboard/reconciliation");
    
    return { success: true };
  } catch (err: any) {
    console.error("[Admin] Delete order failed:", err);
    return { success: false, error: err.message || "Error" };
  }
}
