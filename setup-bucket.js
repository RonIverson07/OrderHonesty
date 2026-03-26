const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const envContent = fs.readFileSync('.env.local', 'utf-8');
const urlMatch = envContent.match(/NEXT_PUBLIC_SUPABASE_URL=(.+)/);
const keyMatch = envContent.match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/);

if (urlMatch && keyMatch) {
  const supabase = createClient(urlMatch[1].trim(), keyMatch[1].trim());

  async function createBucket() {
    console.log("Creating bucket if it doesn't exist...");
    const { data, error } = await supabase.storage.createBucket('order-snapshots', { public: true });
    if (error && error.message !== 'The resource already exists') {
      console.error("Error creating bucket:", error);
    } else {
      console.log("Bucket created or already exists.");
    }

    // Set it to public, just in case
    await supabase.storage.updateBucket('order-snapshots', { public: true });
    console.log("Bucket set to public.");
  }
  
  createBucket();
} else {
  console.log("Env vars not found.");
}
