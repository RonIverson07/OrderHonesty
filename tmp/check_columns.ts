import { createClient } from '@supabase/supabase-js'

async function check() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data: cols, error: err2 } = await supabase.from('inventory_movements').select('*').limit(1)
  if (err2) {
    console.log("TABLE ERROR:", err2.message)
  } else {
    console.log("COLUMNS:", Object.keys(cols[0] || {}))
  }
}

check()
