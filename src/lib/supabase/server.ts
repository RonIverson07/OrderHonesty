import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createClient() {
    const cookieStore = await cookies();

    const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const rawKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const validUrl = rawUrl?.startsWith("http") ? rawUrl : "https://demo.supabase.co";
    const validKey = rawUrl?.startsWith("http") && rawKey ? rawKey : "demo";

    return createServerClient(
        validUrl,
        validKey,
        {
            cookies: {
                getAll() {
                    return cookieStore.getAll();
                },
                setAll(cookiesToSet) {
                    try {
                        cookiesToSet.forEach(({ name, value, options }) =>
                            cookieStore.set(name, value, options)
                        );
                    } catch {
                        // Server component — can't set cookies
                    }
                },
            },
        }
    );
}
