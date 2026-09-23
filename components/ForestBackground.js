"use client";

import { useLayoutEffect, useState } from "react";
import Image from "next/image";
import { usePathname } from "next/navigation";

// 🔥 トップページ（/）と録音画面（/record）で共通の、森の背景写真。
//    レイアウト（app/layout.js）の直下に、ずっと1つだけ置く（ページの部品としては、持たない）。
//    こうすると、2つの画面をスワイプで行き来しても、この部品自体は作り直されない＝写真の要素（<img>）が
//    一度も差し替わらないので、スワイプの瞬間に、背景が一瞬でも動いたり・暗くなったりすることが、原理的に起きない。
//    暗さの層（オーバーレイ）も、ここに含める：以前は、各画面が自分の濃さ（25%・45%）で個別に重ねていたが、
//    スワイプで切り替わる瞬間、写真は同じでも、この濃さがパッと切り替わって「カクッ」と見えていた。
//    ここで固定の濃さにすることで、スワイプ中、背景（写真＋暗さ）が本当に一切変わらなくなる。
//    表示するのは、この2画面のときだけ（他の画面では、何も描かない）。
const FOREST_PAGES = new Set(["/", "/record"]);
const OVERLAY_OPACITY = "bg-black/30";

export default function ForestBackground() {
  const pathname = usePathname();
  const [revealed, setRevealed] = useState(false);
  const [bgHeight, setBgHeight] = useState(null);

  // 🔥 高さは、最初に一度だけ測って固定値（px）にする。アドレスバーの伸縮のたびに測り直すと、
  //    背景の大きさが変わって、動いて見えてしまう（Safari・Android Chrome、共通の注意点）
  useLayoutEffect(() => {
    if (typeof window === "undefined") return;
    setBgHeight(window.innerHeight + 160);
    const t = setTimeout(() => setRevealed(true), 80);
    return () => clearTimeout(t);
  }, []);

  // 静的書き出し（.html）を直接開いたときのため、末尾の .html を取り除いてから比べる
  const cleanPath = (pathname || "/").replace(/\.html$/, "").replace(/\/$/, "") || "/";
  if (!FOREST_PAGES.has(cleanPath)) return null;

  return (
    <div
      className={`fixed top-0 left-0 w-full z-0 bg-black ${revealed ? "opacity-100 brightness-100 saturate-100" : "opacity-0 brightness-[0.35] saturate-[0.55]"}`}
      style={{
        transition: "opacity 2600ms ease-out, filter 2600ms ease-out",
        height: bgHeight ? `${bgHeight}px` : "100vh",
      }}
    >
      <Image src="/forest-bg.jpg" alt="" fill priority sizes="100vw" className="object-cover" />
      <div className={`absolute inset-0 ${OVERLAY_OPACITY}`} />
    </div>
  );
}
