import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
    const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const rawKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const validUrl = rawUrl?.startsWith("http") ? rawUrl : "https://demo.supabase.co";
    const validKey = rawUrl?.startsWith("http") && rawKey ? rawKey : "demo";

    return createBrowserClient(validUrl, validKey);
}
