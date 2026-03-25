import {
  validateAndDeductRetailStock,
  validateAndDeductIngredientStock,
  insertInventoryMovement,
} from "@/lib/db/mutations";
import { getSetting } from "@/lib/domain/settings";
import { sendLowStockAlert } from "@/lib/domain/notifications";
import { createClient } from "@/lib/supabase/server";
import type { RecipeWithIngredient, CartItem } from "@/lib/types";

/**
 * Validate stock availability then deduct for an order.
 * Returns error message if any item has insufficient stock.
 *
 * GAP 1 fix: re-fetches stock right before deduction to prevent race conditions.
 */
export async function processStockDeduction(
  items: CartItem[],
  recipes: RecipeWithIngredient[],
  orderId: string
): Promise<{ success: boolean; error?: string }> {
  const globalThreshold = await getSetting("low_stock_threshold", 10);
  const supabase = await createClient();
  for (const item of items) {
    if (item.product.type === "retail") {
      // Validate & deduct retail stock
      const result = await validateAndDeductRetailStock(
        item.product.id,
        item.qty
      );
      if (!result.success) {
        return {
          success: false,
          error: `${item.product.name}: ${result.error}`,
        };
      }

      // Log movement
      await insertInventoryMovement({
        item_type: "product",
        item_id: item.product.id,
        quantity_delta: -item.qty,
        movement_type: "sale",
        reference_order_id: orderId,
        notes: `Sale of ${item.qty}x ${item.product.name}`,
      });

      // Check low stock
      const { data: stockRow } = await supabase.from("retail_stock").select("stock").eq("product_id", item.product.id).single();
      if (stockRow && stockRow.stock <= globalThreshold!) {
        await sendLowStockAlert(item.product.id, item.product.name, stockRow.stock, globalThreshold!);
      }
    } else {
      // Café product: validate & deduct each ingredient per recipe
      const productRecipes = recipes.filter(
        (r) => r.product_id === item.product.id
      );

      for (const recipe of productRecipes) {
        const totalDeduction = recipe.qty_required * item.qty;

        const result = await validateAndDeductIngredientStock(
          recipe.ingredient_id,
          totalDeduction
        );
        if (!result.success) {
          return {
            success: false,
            error: `${item.product.name}: ${result.error}`,
          };
        }

        await insertInventoryMovement({
          item_type: "ingredient",
          item_id: recipe.ingredient_id,
          quantity_delta: -totalDeduction,
          movement_type: "sale",
          reference_order_id: orderId,
          notes: `Used ${totalDeduction}${recipe.ingredients.unit} of ${recipe.ingredients.name} for ${item.qty}x ${item.product.name}`,
        });

        // Check low stock
        const { data: ingRow } = await supabase.from("ingredients").select("stock").eq("id", recipe.ingredient_id).single();
        if (ingRow && ingRow.stock <= globalThreshold!) {
          await sendLowStockAlert(recipe.ingredient_id, recipe.ingredients.name, ingRow.stock, globalThreshold!);
        }
      }
    }
  }

  return { success: true };
}
