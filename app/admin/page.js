"use client";

import AdminHome from "../../components/AdminHome";
import MinimalHome from "../../components/MinimalHome";
import { useLoginState } from "../../lib/useLoginState";

// 🔥 管理画面（観測地点・観測日・地図）は、ログイン中の人だけ。
//    ログインしていない人が来たら、通常の画面に、ログイン画面を重ねて出す
//    （ログインすると、そのまま管理画面に切り替わる）
export default function AdminPage() {
  const login = useLoginState();
  if (!login.ready) return null; // ログインの判定が終わるまで、何も出さない（一瞬でも管理画面を見せない）
  return login.loggedIn ? <AdminHome /> : <MinimalHome promptLogin />;
}
