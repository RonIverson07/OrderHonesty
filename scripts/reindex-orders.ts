import { createClient } from "@/lib/supabase/server";

export async function reindexAllOrderNumbers() {
  const supabase = await createClient();
  
  try {
    // Get all orders sorted by creation date
    const { data: orders, error } = await supabase
      .from("orders")
      .select("id, order_number, created_at")
      .order("created_at", { ascending: true });
    
    if (error) {
      console.error("Failed to fetch orders:", error);
      return { success: false, error: error.message };
    }
    
    if (!orders || orders.length === 0) {
      return { success: true, message: "No orders found to reindex" };
    }
    
    console.log(`Found ${orders.length} orders to reindex...`);
    
    // Update each order with sequential number
    for (let i = 0; i < orders.length; i++) {
      const order = orders[i];
      const newOrderNumber = (i + 1).toString().padStart(6, '0');
      
      const { error: updateError } = await supabase
        .from("orders")
        .update({ order_number: newOrderNumber })
        .eq("id", order.id);
      
      if (updateError) {
        console.error(`Failed to update order ${order.id}:`, updateError);
        return { success: false, error: `Failed to update order ${order.id}: ${updateError.message}` };
      }
      
      console.log(`Order ${order.id}: ${order.order_number} → ${newOrderNumber}`);
    }
    
    return { 
      success: true, 
      message: `Successfully reindexed ${orders.length} orders from 000001 to ${(orders.length).toString().padStart(6, '0')}` 
    };
    
  } catch (err: any) {
    console.error("Reindexing failed:", err);
    return { success: false, error: err.message };
  }
}

// Run the reindexing
console.log("Starting order number reindexing...");
reindexAllOrderNumbers().then(result => {
  console.log("Reindexing result:", result);
  if (result.success) {
    console.log("✅ All orders have been reindexed with sequential numbers!");
  } else {
    console.error("❌ Reindexing failed:", result.error);
  }
});
