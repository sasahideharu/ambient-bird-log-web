"use client";

import BackLink from "../../components/BackLink";
import { useSystemBars } from "../../lib/useSystemBars";
import ImportSection from "../../components/ImportSection";

// 🔥 データ登録（管理者だけ）。普段は、管理画面の「データ登録」タブから使う。
//    この URL（/import）は、ブックマークなどで、直接開くときのため
export default function ImportPage() {
  useSystemBars("light"); // 明るい背景：バーの文字は黒

  return (
    <div className="abl-page-safe min-h-screen w-full flex justify-center bg-page px-6">
      <div className="w-full max-w-sm bg-page rounded-[28px] border-[6px] border-white shadow-xl overflow-hidden">
        <BackLink fallbackHref="/admin" className="block px-4 pt-4 text-xs font-bold text-[#3F6C74]">
          ‹ 管理画面に戻る
        </BackLink>
        <div className="mx-4 mt-2.5 bg-white border-[3px] border-cardBorder rounded-2xl p-4">
          <div className="font-display text-xl">データ登録</div>
        </div>
        <ImportSection />
      </div>
    </div>
  );
}
