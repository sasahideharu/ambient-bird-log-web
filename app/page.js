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
  // 🔥 録音画面へ移動する「かもしれない」のは、アプリを開いた、その最初の1回だけ（movedInApp が、まだ立っていないとき）。
  //    最初の描画の時点で、一度だけ決める（アプリの中で画面を移動している間は、変わらない）。
  //    ここが false（＝2回目以降の訪問。録音画面からスワイプで戻ってきた、など）なら、ログイン状態を待たずに、
  //    そのままトップを描く＝背景の写真が、途切れずに続けて見える（黒い画面を挟まない）
  const [mightRedirect] = useState(() => !wantsAdmin && isNativeApp() && !hasNavigatedInApp());

  // 🔥 以前の管理画面のURL（/?admin=true）は、専用のページ /admin に移す。
  //    （同じ / の中でクエリだけを切り替える移動は、Next.js のページ移動では効かないため、別のページに分けた）
  useEffect(() => {
    if (wantsAdmin) router.replace("/admin");
  }, [wantsAdmin, router]);

  // 🔥 アプリ（スマホ）を開いた、その最初の1回だけ：ログイン中なら、トップではなく録音画面を開く
  //    （フィールドで、すぐに解析を始められるように）
  useEffect(() => {
    if (!mightRedirect || !login.ready || redirecting) return;
    if (login.loggedIn) {
      setRedirecting(true);
      router.replace("/record");
    }
  }, [mightRedirect, login.ready, login.loggedIn, redirecting, router]);

  if (wantsAdmin) return null;
  // 録音画面へ移動する「かもしれない」ときだけ、判定・移動が終わるまで、何も出さない（トップが一瞬だけ見えてしまわないように）。
  // それ以外（2回目以降の訪問）は、待たずに、そのままトップを見せる
  if (mightRedirect && (!login.ready || redirecting)) return <div className="fixed inset-0 bg-black" />;
  return <MinimalHome />;
}

export default function Page() {
  return (
    <Suspense fallback={<div className="fixed inset-0 bg-black" />}>
      <PageInner />
    </Suspense>
  );
}
