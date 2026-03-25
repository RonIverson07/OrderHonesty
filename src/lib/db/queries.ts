import { createClient } from "@/lib/supabase/server";
import type {
  Product,
  ProductWithStock,
  Ingredient,
  RecipeWithIngredient,
  OrderWithItems,
  RetailStock,
  CafeProductAvailability,
} from "@/lib/types";

// ---- Products ----

export async function getProductsByType(
  type: "cafe" | "retail"
): Promise<ProductWithStock[]> {
  const supabase = await createClient();

  if (type === "retail") {
    const { data, error } = await supabase
      .from("products")
      .select("*, retail_stock(*)")
      .eq("type", "retail")
      .eq("active", true)
      .order("name");

    if (error) throw error;
    return (data ?? []).map((p: Record<string, unknown>) => ({
      ...p,
      retail_stock: Array.isArray(p.retail_stock)
        ? (p.retail_stock as RetailStock[])[0] ?? null
        : p.retail_stock,
    })) as ProductWithStock[];
  }

  const { data, error } = await supabase
    .from("products")
    .select("*")
    .eq("type", "cafe")
    .eq("active", true)
    .order("name");

  if (error) throw error;
  return (data ?? []) as ProductWithStock[];
}

// ---- All products (admin, includes inactive) ----

export async function getAllProducts(): Promise<ProductWithStock[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("products")
    .select("*, retail_stock(*)")
    .order("type")
    .order("name");

  if (error) throw error;
  return (data ?? []).map((p: Record<string, unknown>) => ({
    ...p,
    retail_stock: Array.isArray(p.retail_stock)
      ? (p.retail_stock as RetailStock[])[0] ?? null
      : p.retail_stock,
  })) as ProductWithStock[];
}

export async function getProductById(id: string): Promise<ProductWithStock | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("products")
    .select("*, retail_stock(*)")
    .eq("id", id)
    .single();

  if (error) return null;
  return {
    ...data,
    retail_stock: Array.isArray(data.retail_stock)
      ? data.retail_stock[0] ?? null
      : data.retail_stock,
  } as ProductWithStock;
}

// ---- Café availability check ----

export async function getCafeProductsWithAvailability(): Promise<CafeProductAvailability[]> {
  const supabase = await createClient();

  const { data: products, error: prodError } = await supabase
    .from("products")
    .select("*")
    .eq("type", "cafe")
    .eq("active", true)
    .order("name");

  if (prodError) throw prodError;
  if (!products || products.length === 0) return [];

  const productIds = products.map((p: Product) => p.id);
  const { data: recipes, error: recipeError } = await supabase
    .from("recipes")
    .select("*, ingredients(*)")
    .in("product_id", productIds);

  if (recipeError) throw recipeError;

  return products.map((product: Product) => {
    const myRecipes = ((recipes ?? []) as RecipeWithIngredient[]).filter(
      (r) => r.product_id === product.id
    );

    if (myRecipes.length === 0) return { ...product, available: true };

    let minServings = Infinity;
    for (const recipe of myRecipes) {
      const servings = Math.floor(recipe.ingredients.stock / recipe.qty_required);
      minServings = Math.min(minServings, servings);
      if (recipe.ingredients.stock < recipe.qty_required) {
        return {
          ...product,
          available: false,
          unavailable_reason: `Low on ${recipe.ingredients.name}`,
          max_servings: 0,
        };
      }
    }

    return { ...product, available: true, max_servings: minServings };
  });
}

// ---- Recipes ----

export async function getRecipesForProduct(productId: string): Promise<RecipeWithIngredient[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("recipes")
    .select("*, ingredients(*)")
    .eq("product_id", productId);

  if (error) throw error;
  return (data ?? []) as RecipeWithIngredient[];
}

export async function getRecipesForProducts(productIds: string[]): Promise<RecipeWithIngredient[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("recipes")
    .select("*, ingredients(*)")
    .in("product_id", productIds);

  if (error) throw error;
  return (data ?? []) as RecipeWithIngredient[];
}

// ---- Ingredients ----

export async function getAllIngredients(): Promise<Ingredient[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ingredients")
    .select("*")
    .order("name");

  if (error) throw error;
  return (data ?? []) as Ingredient[];
}

// ---- Orders ----

export async function getRecentOrders(limit = 50): Promise<OrderWithItems[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("orders")
    .select("*, order_items(*, products(*))")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data ?? []) as OrderWithItems[];
}

export async function getTodaysOrders(): Promise<OrderWithItems[]> {
  const supabase = await createClient();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const { data, error } = await supabase
    .from("orders")
    .select("*, order_items(*, products(*))")
    .gte("created_at", today.toISOString())
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data ?? []) as OrderWithItems[];
}

export async function getCafeOrdersByStatus(): Promise<OrderWithItems[]> {
  const supabase = await createClient();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const { data, error } = await supabase
    .from("orders")
    .select("*, order_items(*, products(*))")
    .eq("source", "cafe")
    .in("status", ["new", "preparing", "ready"])
    .gte("created_at", today.toISOString())
    .order("created_at", { ascending: true });

  if (error) throw error;
  return (data ?? []) as OrderWithItems[];
}

// ---- Stock Alerts ----

export async function getLowStockRetail(): Promise<(Product & { retail_stock: RetailStock })[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("products")
    .select("*, retail_stock(*)")
    .eq("type", "retail")
    .eq("active", true);

  if (error) throw error;

  return ((data ?? []) as (Product & { retail_stock: RetailStock[] })[])
    .map((p) => ({
      ...p,
      retail_stock: Array.isArray(p.retail_stock) ? p.retail_stock[0] : p.retail_stock,
    }))
    .filter(
      (p) =>
        p.retail_stock &&
        p.low_stock_threshold !== null &&
        p.retail_stock.stock <= p.low_stock_threshold
    ) as (Product & { retail_stock: RetailStock })[];
}

export async function getLowStockIngredients(): Promise<Ingredient[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("ingredients").select("*").order("name");

  if (error) throw error;
  return (data ?? []).filter((i: Ingredient) => i.stock <= i.low_stock_threshold);
}

// ---- Dashboard Stats ----

export async function getDashboardStats() {
  const orders = await getTodaysOrders();

  const totalOrders = orders.length;
  const totalRevenue = orders.reduce((s, o) => s + Number(o.total_price), 0);
  const totalCost = orders.reduce((s, o) => s + Number(o.total_cost), 0);
  const totalMargin = totalRevenue - totalCost;
  const cafeOrders = orders.filter((o) => o.source === "cafe").length;
  const fridgeOrders = orders.filter((o) => o.source === "fridge").length;
  const totalConfirmed = orders
    .filter((o) => o.payment_confirmed)
    .reduce((s, o) => s + Number(o.total_price), 0);
  const unconfirmedCount = orders.filter((o) => !o.payment_confirmed).length;

  return {
    totalOrders,
    totalRevenue,
    totalCost,
    totalMargin,
    cafeOrders,
    fridgeOrders,
    totalExpected: totalRevenue,
    totalConfirmed,
    unconfirmedCount,
  };
}
