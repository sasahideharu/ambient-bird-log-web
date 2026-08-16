"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import AdminHome from "../components/AdminHome";
import MinimalHome from "../components/MinimalHome";

function PageInner() {
  const searchParams = useSearchParams();
  const isAdmin = searchParams.get("admin") === "true";
  return isAdmin ? <AdminHome /> : <MinimalHome />;
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <PageInner />
    </Suspense>
  );
}
