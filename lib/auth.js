// 🔥 ログイン（メールアドレス＋パスワード）まわり。
//    ログイン中の人だけが、緯度経度・地図・管理画面・オフライン保存を使える。
//    ※ 新規登録の画面は無い。アカウントは Supabase の管理画面で手動で作る（登録は止めてある）
import { supabase, AUTH_STORAGE_KEY } from "./supabaseClient";

// 端末に残っているログイン情報を読む（通信しない）
function readStoredSession() {
  try {
    const raw = window.localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    const stored = JSON.parse(raw);
    return stored?.refresh_token ? stored : null;
  } catch {
    return null;
  }
}

// 現在のログイン（セッション）を取る。電波が弱くて認証の更新が長引くときは、3秒で切り上げて null を返す
async function currentSession() {
  const result = await Promise.race([
    supabase.auth.getSession(),
    new Promise((resolve) => setTimeout(() => resolve(null), 3000)),
  ]);
  return result?.data?.session ?? null;
}

// 画面の出し分け用の「ログイン中か」。
//   電波が無くて、期限切れの認証を更新できないとき（圏外の現地など）も、
//   端末にログイン情報が残っていれば「ログイン中」とみなす
export async function getLoginState() {
  if (typeof window === "undefined") return { loggedIn: false, email: null };

  const session = await currentSession();
  if (session) return { loggedIn: true, email: session.user?.email ?? null };

  const stored = readStoredSession();
  if (stored) return { loggedIn: true, email: stored.user?.email ?? null };

  return { loggedIn: false, email: null };
}

// データを取るときの判定用の「有効なログインがあるか」（緯度経度を要求してよいか）
export async function hasLoginSession() {
  if (typeof window === "undefined") return false;
  return !!(await currentSession());
}

export async function signIn(email, password) {
  const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
  return { error };
}

export async function signOut() {
  const { error } = await supabase.auth.signOut({ scope: "local" });
  if (error) {
    // 通信できなくても、この端末のログイン情報だけは消す
    try {
      window.localStorage.removeItem(AUTH_STORAGE_KEY);
    } catch {
      // 何もしない
    }
  }
}

// ログイン／ログアウトのたびに、最新の状態を渡す。戻り値は「監視をやめる」関数
export function onAuthChange(callback) {
  const { data } = supabase.auth.onAuthStateChange(() => {
    // コールバックの中で認証の関数を直接呼ぶと止まることがあるため、少し置いてから呼ぶ
    setTimeout(() => {
      getLoginState().then(callback);
    }, 0);
  });
  return () => data.subscription.unsubscribe();
}
