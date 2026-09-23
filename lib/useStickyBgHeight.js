"use client";

import { useLayoutEffect, useRef, useState } from "react";

// 🔥 背景の写真（sticky）の高さを決める。
//    最初は「画面の高さ＋少し」だけを使う（今までどおり。アドレスバーの伸縮のたびに測り直すと、
//    InstagramやLINEのアプリ内ブラウザで、背景がズームして見えてしまうため、ここは測り直さない）。
//    growKey が変わったとき（＝一覧の件数など、内容が変わったとき）だけ、実際に描かれた内容の高さを測り、
//    今までの高さでは足りなければ、大きくする（縮めない）。
//    こうすると、一覧が画面より長く伸びても、背景がスクロールの途中で剥がれて、下地の黒が見えることがなくなる。
//    ページの移動（画面の生成し直し）は含まれないので、アプリ内ブラウザのアドレスバー対策は、そのまま活きる
export function useStickyBgHeight(growKey) {
  const [bgHeight, setBgHeight] = useState(null);
  const first = useRef(true);

  useLayoutEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") return;
    if (first.current) {
      first.current = false;
      setBgHeight(window.innerHeight + 160);
      return;
    }
    const need = document.body.scrollHeight + 160;
    setBgHeight((prev) => (prev == null || need > prev ? need : prev));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [growKey]);

  return bgHeight;
}
