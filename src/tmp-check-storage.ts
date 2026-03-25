
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function check() {
  const { data: buckets, error: bError } = await supabase.storage.listBuckets();
  if (bError) console.log("List error:", bError.message);
  console.log("Buckets:", JSON.stringify(buckets, null, 2));
  
  // Try to create the bucket just in case it's missing
  const { data: nBucket, error: nError } = await supabase.storage.createBucket('product-images', { public: true });
  if (nError) console.log("Create product-images error:", nError.message);
  else console.log("Bucket 'product-images' created!");
}

check();
