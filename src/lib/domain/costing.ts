import type { RecipeWithIngredient, Product } from "@/lib/types";

/**
 * Compute cost for a single unit of a product.
 *
 * - Retail: uses product.base_cost
 * - Café: sums ingredient costs from recipe (unit_cost × qty_required)
 */
export function computeUnitCost(
    product: Product,
    recipes: RecipeWithIngredient[]
): number {
    if (product.type === "retail") {
        return product.base_cost ?? 0;
    }

    // Café product: sum of recipe ingredient costs
    const productRecipes = recipes.filter(
        (r) => r.product_id === product.id
    );

    return productRecipes.reduce((total, r) => {
        const ingredientCost = r.ingredients.unit_cost * r.qty_required;
        return total + ingredientCost;
    }, 0);
}

/**
 * Compute totals for a set of order items.
 */
export function computeOrderTotals(
    items: { product: Product; qty: number; unitCost: number }[]
): {
    totalPrice: number;
    totalCost: number;
    margin: number;
} {
    let totalPrice = 0;
    let totalCost = 0;

    for (const item of items) {
        totalPrice += item.product.selling_price * item.qty;
        totalCost += item.unitCost * item.qty;
    }

    return {
        totalPrice: Math.round(totalPrice * 100) / 100,
        totalCost: Math.round(totalCost * 100) / 100,
        margin: Math.round((totalPrice - totalCost) * 100) / 100,
    };
}
