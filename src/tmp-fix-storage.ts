
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function check() {
  const buckets = ['product-images', 'payment-proofs', 'order-snapshots'];
  for (const b of buckets) {
    const { data, error } = await supabase.storage.createBucket(b, { public: true });
    if (error) console.log(`Bucket ${b}: ${error.message}`);
    else console.log(`Bucket ${b} created!`);
  }
}

check();
