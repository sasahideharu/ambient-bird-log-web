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

// 🔥 公開用のキー（画面に含まれている、誰でも見られるもの）。解析サーバーが、ログインの確認を Supabase に問い合わせるときに、
//    画面から一緒に渡す（サーバーには、キーを置かない）
export const SUPABASE_PUBLIC_KEY = supabaseAnonKey;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storageKey: AUTH_STORAGE_KEY,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false, // メールのリンクではなく、パスワードでログインするため
  },
});
