"use client";

import { useState } from "react";
import { signIn } from "../lib/auth";

function messageFor(error) {
  const m = (error?.message ?? "").toLowerCase();
  if (m.includes("invalid login credentials")) return "メールアドレスまたはパスワードが違います。";
  if (m.includes("email not confirmed")) return "メールアドレスの確認が済んでいません。";
  if (error?.status === 0 || m.includes("fetch") || m.includes("network")) {
    return "通信できませんでした。電波の良い場所で、もう一度お試しください。";
  }
  return "ログインできませんでした。もう一度お試しください。";
}

// 🔥 ログイン画面（メールアドレス＋パスワード）。新規登録の画面は無い
//   （アカウントは Supabase の管理画面で手動で作る）
export default function LoginPanel({ open, onClose, notice }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  if (!open) return null;

  async function handleSubmit(e) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const { error: err } = await signIn(email, password);
    setBusy(false);
    if (err) {
      setError(messageFor(err));
      return;
    }
    setPassword(""); // パスワードは、この画面にも残さない
    onClose();
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center px-5" onClick={busy ? undefined : onClose}>
      <div className="absolute inset-0 bg-black/55" />
      <form
        onSubmit={handleSubmit}
        className="relative w-full max-w-sm rounded-[28px] bg-black/40 backdrop-blur-2xl border border-white/20 text-white px-6 py-7"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          aria-label="閉じる"
          className="absolute top-4 right-4 w-9 h-9 rounded-full bg-black/30 text-white text-lg flex items-center justify-center disabled:opacity-30"
        >
          ×
        </button>

        <h2 className="font-hero text-2xl text-center">ログイン</h2>
        {notice && <p className="mt-3 text-center text-[11px] text-white/60 leading-relaxed">{notice}</p>}

        <label className="block mt-6 text-[11px] text-white/60">メールアドレス</label>
        <input
          type="email"
          name="email"
          autoComplete="username"
          inputMode="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mt-1 w-full rounded-xl bg-white/10 px-4 py-3 text-sm text-white outline-none focus:bg-white/15"
        />

        <label className="block mt-4 text-[11px] text-white/60">パスワード</label>
        <input
          type="password"
          name="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-1 w-full rounded-xl bg-white/10 px-4 py-3 text-sm text-white outline-none focus:bg-white/15"
        />

        {error && <p className="mt-4 text-center text-xs text-[#F0B4AE]">{error}</p>}

        <button
          type="submit"
          disabled={busy || !email || !password}
          className="mt-6 w-full rounded-xl bg-white/90 text-black text-sm font-medium py-3 disabled:opacity-40"
        >
          {busy ? "ログイン中…" : "ログイン"}
        </button>
      </form>
    </div>
  );
}
