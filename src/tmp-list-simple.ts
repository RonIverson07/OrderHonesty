
import { createClient } from "@supabase/supabase-js";
import fs from "fs";

// Read from .env.local to be 100% sure
const env = fs.readFileSync(".env.local", "utf8");
const url = env.split('\n').find(l => l.startsWith('NEXT_PUBLIC_SUPABASE_URL='))?.split('=')[1]?.trim();
const key = env.split('\n').find(l => l.startsWith('SUPABASE_SERVICE_ROLE_KEY='))?.split('=')[1]?.trim();

const supabase = createClient(url!, key!);

async function check() {
  const { data: buckets } = await supabase.storage.listBuckets();
  console.log("Found Buckets:");
  buckets?.forEach(b => console.log(`- ${b.name} (public: ${b.public})`));
}

check();
