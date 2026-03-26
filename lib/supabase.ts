import { createClient } from "@supabase/supabase-js";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY must be set",
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    // Use AsyncStorage on native so sessions survive app restarts.
    // On web the SDK defaults to localStorage, which is correct.
    storage: Platform.OS !== "web" ? AsyncStorage : undefined,
    autoRefreshToken: true,
    persistSession: true,
    // Let the SDK handle URL-based session detection on web (magic link redirect).
    // On native we handle the deep link manually via Linking.
    detectSessionInUrl: Platform.OS === "web",
    // PKCE flow: magic link redirects with a short-lived code instead of the
    // raw access_token, so the token never appears in the browser URL/history.
    flowType: "pkce",
  },
});
