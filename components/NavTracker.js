"use client";

import { useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { markInAppNavigation } from "../lib/backNav";

// 🔥 画面の移動（住所の変化）を見張って、「アプリの中で移動してきた」ことを覚える（画面には何も出さない）。
//    「戻る」で、一つ前の画面へ戻ってよいか（この画面を直接開いたのではないか）を、判断するため
export default function NavTracker() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false; // 最初に開いたときは、移動ではない
      return;
    }
    markInAppNavigation();
  }, [pathname, search]);
  return null;
}
