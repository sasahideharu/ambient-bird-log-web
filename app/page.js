"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import MinimalHome from "../components/MinimalHome";

function PageInner() {
  const router = useRouter();
  const wantsAdmin = useSearchParams().get("admin") === "true";

  // 🔥 以前の管理画面のURL（/?admin=true）は、専用のページ /admin に移す。
  //    （同じ / の中でクエリだけを切り替える移動は、Next.js のページ移動では効かないため、別のページに分けた）
  useEffect(() => {
    if (wantsAdmin) router.replace("/admin");
  }, [wantsAdmin, router]);

  if (wantsAdmin) return null;
  return <MinimalHome />;
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <PageInner />
    </Suspense>
  );
}
