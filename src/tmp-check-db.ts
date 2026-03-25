
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function check() {
  const { data, error } = await supabase
    .from("products")
    .select("*")
    .eq("name", "Juice")
    .single();
  
  if (error) console.error("Error:", error);
  else console.log("Product:", JSON.stringify(data, null, 2));
  
  const { data: buckets } = await supabase.storage.listBuckets();
  console.log("Buckets:", JSON.stringify(buckets, null, 2));
  
  try {
     const { data: files } = await supabase.storage.from('product-images').list();
     console.log("Files in product-images:", files?.length);
  } catch (e) {
     console.log("Error listing products bucket");
  }
}

check();
