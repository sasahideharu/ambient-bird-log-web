"use client";

import { useState, useMemo } from "react";

// 🔥 仮データ（本実装では Supabase の bird_master / detections テーブルから取得する）
const SPECIES = [
  { name: "メジロ", confidence: 82, color: "#C7D3C9", emoji: "🐦" },
  { name: "スズメ", confidence: 68, color: "#D9CFC0", emoji: "🐤" },
  { name: "ヒヨドリ", confidence: 91, color: "#C9C7D1", emoji: "🐧" },
  { name: "シジュウカラ", confidence: 74, color: "#BFCDB8", emoji: "🦜" },
  { name: "ウグイス", confidence: 55, color: "#D9CBA0", emoji: "🐥" },
  { name: "カワセミ", confidence: 88, color: "#B7CBCE", emoji: "🦆" },
];

export default function HomePage() {
  const [activeTab, setActiveTab] = useState("species");
  const [minConfidence, setMinConfidence] = useState(60);
  const [keyword, setKeyword] = useState("");

  const visible = useMemo(() => {
    return SPECIES.filter(
      (s) =>
        s.confidence >= minConfidence &&
        (keyword.trim() === "" || s.name.includes(keyword.trim()))
    );
  }, [minConfidence, keyword]);

  return (
    <div className="min-h-screen w-full flex justify-center bg-page p-6">
      <div className="w-full max-w-sm bg-page rounded-[28px] border-[6px] border-white shadow-xl overflow-hidden">
        {/* ヘッダーバナー */}
        <div className="bg-header px-6 pt-6 pb-6 rounded-b-3xl">
          <div className="text-[10px] tracking-[2px] text-headerText font-bold opacity-85">
            FIELD OBSERVATION RECORD
          </div>
          <h1 className="font-display text-white text-2xl mt-1.5">
            🎧 Ambient Bird Log 🐦
          </h1>
          <p className="text-headerText text-xs font-bold mt-1">
            身近な野鳥の観察記録
          </p>
        </div>

        {/* タブ */}
        <div className="flex px-5 pt-4 border-b border-cardBorder">
          <button
            onClick={() => setActiveTab("species")}
            className={`pb-2 mr-6 text-sm font-bold border-b-[3px] transition-colors ${
              activeTab === "species"
                ? "text-ink border-accentText"
                : "text-inkMuted border-transparent"
            }`}
          >
            🐦 種目録
          </button>
          <button
            onClick={() => setActiveTab("location")}
            className={`pb-2 text-sm font-bold border-b-[3px] transition-colors ${
              activeTab === "location"
                ? "text-ink border-accentText"
                : "text-inkMuted border-transparent"
            }`}
          >
            📍 観測地点
          </button>
        </div>

        {activeTab === "species" ? (
          <>
            {/* 信頼度フィルタ */}
            <div className="mx-4 mt-4 bg-white border-[3px] border-cardBorder rounded-2xl px-4 py-3">
              <label className="text-xs font-bold text-ink">
                信頼度フィルタ{"　"}
                <span className="text-accentText font-black">
                  {minConfidence}%
                </span>
              </label>
              <input
                type="range"
                min={0}
                max={100}
                value={minConfidence}
                onChange={(e) => setMinConfidence(Number(e.target.value))}
                className="abl-slider w-full mt-2 h-1 rounded-full appearance-none cursor-pointer"
                style={{
                  background: `linear-gradient(to right, #B4CF9E ${minConfidence}%, #E5E0D2 ${minConfidence}%)`,
                }}
              />
            </div>

            {/* 検索ボックス */}
            <div className="mx-4 mt-3">
              <input
                type="text"
                placeholder="和名で検索"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                className="w-full px-4 py-2.5 rounded-2xl border-[3px] border-cardBorder bg-white text-sm text-ink placeholder:text-[#B7B7A8] outline-none focus:border-accent"
              />
            </div>

            {/* 写真グリッド */}
            <div className="grid grid-cols-3 gap-2 px-4 pt-4 pb-5">
              {visible.map((s) => (
                <div
                  key={s.name}
                  className="rounded-2xl overflow-hidden border-[3px] border-cardBorder bg-white relative"
                >
                  <div
                    className="aspect-square flex items-center justify-center text-3xl"
                    style={{ backgroundColor: s.color }}
                  >
                    {s.emoji}
                  </div>
                  <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-[10px] font-bold text-center py-1.5">
                    {s.name}
                  </div>
                </div>
              ))}
              {visible.length === 0 && (
                <div className="col-span-3 text-center text-xs text-inkMuted py-6">
                  この信頼度以上の記録は見つかりませんでした
                </div>
              )}
            </div>
            <p className="text-center text-[10px] text-inkMuted pb-4 px-6">
              ※ 写真は実装後、Supabaseに登録した実際の鳥の画像に置き換わります
            </p>
          </>
        ) : (
          <div className="px-6 py-10 text-center text-sm text-inkMuted">
            観測地点タブの中身は次のステップで作ります
          </div>
        )}
      </div>
    </div>
  );
}
