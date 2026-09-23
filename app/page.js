"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import MinimalHome from "../components/MinimalHome";
import { useLoginState } from "../lib/useLoginState";
import { isNativeApp } from "../lib/offline";
import { hasNavigatedInApp } from "../lib/backNav";

function PageInner() {
  const router = useRouter();
  const wantsAdmin = useSearchParams().get("admin") === "true";
  const login = useLoginState();
  const [redirecting, setRedirecting] = useState(false);

  // 🔥 以前の管理画面のURL（/?admin=true）は、専用のページ /admin に移す。
  //    （同じ / の中でクエリだけを切り替える移動は、Next.js のページ移動では効かないため、別のページに分けた）
  useEffect(() => {
    if (wantsAdmin) router.replace("/admin");
  }, [wantsAdmin, router]);

  // 🔥 アプリ（スマホ）を開いた、その最初の1回だけ：ログイン中なら、トップではなく録音画面を開く
  //    （フィールドで、すぐに解析を始められるように）。すでに、アプリの中で画面を移動したあと（＝この
  //    「開いた最初の1回」ではない。例：録音画面からスワイプで戻ってきた）なら、ふつうにトップを見せる
  useEffect(() => {
    if (wantsAdmin || !login.ready || redirecting) return;
    if (isNativeApp() && login.loggedIn && !hasNavigatedInApp()) {
      setRedirecting(true);
      router.replace("/record");
    }
  }, [wantsAdmin, login.ready, login.loggedIn, redirecting, router]);

  if (wantsAdmin) return null;
  // ログイン状態が分かるまで・録音画面へ移動する間は、何も出さない（トップが一瞬だけ見えてしまわないように）
  if (!login.ready || redirecting) return <div className="fixed inset-0 bg-black" />;
  return <MinimalHome />;
}

export default function Page() {
  return (
    <Suspense fallback={<div className="fixed inset-0 bg-black" />}>
      <PageInner />
    </Suspense>
  );
}
