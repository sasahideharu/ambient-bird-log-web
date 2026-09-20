"use client";

import { Suspense, useMemo } from "react";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { useSystemBars } from "../../lib/useSystemBars";
import { goBack } from "../../lib/backNav";

// 🔥 3D 表示の部品（three.js）は、大きいので、この画面を開いたときだけ読み込む（他の画面は、重くならない）
const Spectrogram3D = dynamic(() => import("../../components/Spectrogram3D"), {
  ssr: false,
  loading: () => (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-[#0c0e12] text-[12px] text-[#93a0b0]">3D 表示を準備しています…</div>
  ),
});

const numOrNull = (v) => {
  if (v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// 🔥 3D スペクトログラム（誰でも見られる）。アプリ化（静的書き出し）に対応するため、URL は
//    /view3d?src=<録音のURL>&start=3&end=12 の形（録音カードの拡大表示の「3Dで見る」から開く）。start・end が無いときは、録音の全体
function View3DInner() {
  useSystemBars("dark"); // 暗い背景：バーの文字は白
  const router = useRouter();
  const params = useSearchParams();
  const src = params.get("src");
  const start = numOrNull(params.get("start"));
  const end = numOrNull(params.get("end"));

  const title = useMemo(() => {
    if (!src) return "";
    let name = "";
    try {
      name = decodeURIComponent(src.split("?")[0].split("/").pop() ?? "");
    } catch {
      name = "";
    }
    const range = start != null && end != null && end > start ? `（${start}〜${end}秒）` : "";
    return `${name}${range}`;
  }, [src, start, end]);

  const close = () => goBack(router, "/"); // 一つ前の画面へ（直接開いたときだけ、トップへ）

  return <Spectrogram3D src={src} startSec={start} endSec={end != null && start != null && end > start ? end : null} title={title} onClose={close} />;
}

export default function View3DPage() {
  return (
    <Suspense fallback={null}>
      <View3DInner />
    </Suspense>
  );
}
