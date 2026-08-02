import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  // 🔥 環境変数が.env.localに正しく設定されていないと、ここで気づけるようにしておく
  console.warn(
    "Supabaseの接続情報（NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY）が.env.localに設定されていません。"
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
