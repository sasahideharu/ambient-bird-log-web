import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  // 🔥 環境変数が.env.localに正しく設定されていないと、ここで気づけるようにしておく
  console.warn(
    "Supabaseの接続情報（NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY）が.env.localに設定されていません。"
  );
}

// 🔥 ログイン情報を端末（ブラウザ／アプリ）に保存するときの名前。
//    電波が無いときも「ログイン中」を判定できるよう、lib/auth.js から直接読むために固定している
export const AUTH_STORAGE_KEY = "abl-auth";

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storageKey: AUTH_STORAGE_KEY,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false, // メールのリンクではなく、パスワードでログインするため
  },
});
