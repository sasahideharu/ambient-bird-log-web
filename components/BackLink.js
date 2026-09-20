"use client";

import { useRouter } from "next/navigation";
import { goBack } from "../lib/backNav";

// 🔥 「‹ ○○に戻る」：一つ前の画面へ戻る。前の画面が無い（この画面を、直接開いた）ときだけ、fallbackHref へ行く
export default function BackLink({ fallbackHref, className, children }) {
  const router = useRouter();
  return (
    <button type="button" onClick={() => goBack(router, fallbackHref)} className={className}>
      {children}
    </button>
  );
}
