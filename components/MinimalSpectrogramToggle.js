"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import MinimalSpectrogram from "./MinimalSpectrogram";

// 3D の部品（three.js）は大きいので、必要になったときに読み込む
const Inline3D = dynamic(() => import("./MinimalSpectrogram3D"), { ssr: false });

const pill = "rounded-full bg-black/45 backdrop-blur-sm border border-white/20 text-white/90 text-[11px] font-semibold px-3 py-1.5";

// いちばん近い、スクロールする親（ウィンドウの中の一覧）を探す
function findScrollParent(el) {
  for (let p = el?.parentElement; p; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY;
    if (oy === "auto" || oy === "scroll") return p;
  }
  return null;
}

// 🔥 ミニマルトップページの、鳥の窓の録音：はじめは3D。「2Dで見る」ボタンで、いまの2D（スペクトログラム）に切り替わる（「3Dに戻す」で戻る）。
//    「大きく見る」は、3D の全画面（回す・設定・再生）を開く。
//    録音が何十件も並ぶことがあり、3D は1件ごとに描画の枠（WebGL）を使うので、画面の近くにあるものだけを 3D にする（離れたものは、片づける）。
//    3D が使えない端末・録音は、自動で2D にする（そのときは、切り替えボタンを出さない）
export default function MinimalSpectrogramToggle({ src, startSec, endSec }) {
  const [mode, setMode] = useState("3d"); // "3d" | "2d"
  const [unavailable, setUnavailable] = useState(false);
  const [near, setNear] = useState(false); // 画面の近くにあるか
  const [playing3d, setPlaying3d] = useState(false);
  const boxRef = useRef(null);

  useEffect(() => {
    const el = boxRef.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setNear(true);
      return;
    }
    // 見えるより少し先（上下320px）まで、先に用意しておく
    const io = new IntersectionObserver(([e]) => setNear(e.isIntersecting), {
      root: findScrollParent(el),
      rootMargin: "320px 0px",
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const show3d = mode === "3d" && !unavailable;

  useEffect(() => {
    if (!show3d) setPlaying3d(false);
  }, [show3d]);

  const bigHref = src
    ? `/view3d?src=${encodeURIComponent(src)}${startSec != null ? `&start=${startSec}` : ""}${endSec != null ? `&end=${endSec}` : ""}`
    : null;

  return (
    <div ref={boxRef} className="relative">
      {show3d ? (
        near || playing3d ? (
          <Inline3D
            src={src}
            startSec={startSec}
            endSec={endSec}
            onUnavailable={() => setUnavailable(true)}
            onPlayingChange={setPlaying3d}
          />
        ) : (
          <div className="w-full rounded-2xl bg-[#0c0e12]" style={{ aspectRatio: "3 / 2" }} />
        )
      ) : (
        <MinimalSpectrogram src={src} startSec={startSec} endSec={endSec} />
      )}

      {!unavailable && (
        <div className="absolute top-2 right-2 z-10 flex gap-1.5">
          {show3d ? (
            <>
              <button onClick={() => setMode("2d")} className={pill}>
                2Dで見る
              </button>
              {bigHref && (
                <Link href={bigHref} className={pill}>
                  大きく見る
                </Link>
              )}
            </>
          ) : (
            <button onClick={() => setMode("3d")} className={pill}>
              3Dに戻す
            </button>
          )}
        </div>
      )}
    </div>
  );
}
