import { NextRequest, NextResponse } from 'next/server';
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    
    // Get all orders sorted by creation date
    const { data: orders, error } = await supabase
      .from("orders")
      .select("id, order_number, created_at")
      .order("created_at", { ascending: true });
    
    if (error) {
      console.error("Failed to fetch orders:", error);
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
    
    if (!orders || orders.length === 0) {
      return NextResponse.json({ success: true, message: "No orders found to reindex" });
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
        return NextResponse.json({ 
          success: false, 
          error: `Failed to update order ${order.id}: ${updateError.message}` 
        }, { status: 500 });
      }
      
      console.log(`Order ${order.id}: ${order.order_number} → ${newOrderNumber}`);
    }
    
    return NextResponse.json({ 
      success: true, 
      message: `Successfully reindexed ${orders.length} orders from 000001 to ${(orders.length).toString().padStart(6, '0')}` 
    });
    
  } catch (err: any) {
    console.error("Reindexing failed:", err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
