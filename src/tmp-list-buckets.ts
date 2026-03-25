
import { createClient } from "@supabase/supabase-js";
import fs from "fs";

// Read from .env.local to be 100% sure
const env = fs.readFileSync(".env.local", "utf8");
const url = env.match(/NEXT_PUBLIC_SUPABASE_URL=(.*)/)?.[1]?.trim();
const key = env.match(/SUPABASE_SERVICE_ROLE_KEY=(.*)/)?.[1]?.trim();

console.log("URL:", url);
console.log("KEY length:", key?.length);

const supabase = createClient(url!, key!);

async function check() {
  const { data: buckets, error } = await supabase.storage.listBuckets();
  if (error) console.log("Error:", error.message);
  console.log("Actual Buckets:", JSON.stringify(buckets, null, 2));
}

check();
