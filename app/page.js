"use client";

import { useState, useMemo, useEffect } from "react";
import Link from "next/link";
import { fetchDetections, fetchBirdImages } from "../lib/queries";
import { buildSpeciesList, buildLocationList } from "../lib/aggregate";

// 🔥 写真がまだ登録されていない鳥のプレースホルダー色（絵文字はひとまず共通）
const PLACEHOLDER_COLOR = "#C7D3C9";
const PLACEHOLDER_EMOJI = "🐦";

export default function HomePage() {
  const [activeTab, setActiveTab] = useState("species");
  const [minConfidence, setMinConfidence] = useState(60);
  const [keyword, setKeyword] = useState("");

  const [rawDetections, setRawDetections] = useState([]);
  const [birdImages, setBirdImages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  useEffect(() => {
    async function load() {
      try {
        const [detections, images] = await Promise.all([
          fetchDetections(),
          fetchBirdImages(),
        ]);
        setRawDetections(detections);
        setBirdImages(images);
      } catch (err) {
        console.error(err);
        setLoadError(
          "データの取得に失敗しました。.env.localの接続情報を確認してください。"
        );
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  // 🔥 「信頼度○%以上の記録が1件でもあれば、その鳥を種目録に出す」という判定にするため、
  //    先に記録を信頼度で絞り込んでから、鳥ごとに集計する
  const visible = useMemo(() => {
    const filteredDetections = rawDetections.filter(
      (d) => Math.round(d.confidence * 100) >= minConfidence
    );
    const speciesList = buildSpeciesList(filteredDetections, birdImages);
    return speciesList.filter(
      (s) => keyword.trim() === "" || s.name.includes(keyword.trim())
    );
  }, [rawDetections, birdImages, minConfidence, keyword]);

  const locations = useMemo(() => buildLocationList(rawDetections), [rawDetections]);

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
            {loading && (
              <p className="text-center text-xs text-inkMuted py-6">読み込み中...</p>
            )}
            {loadError && (
              <p className="text-center text-xs text-red-500 py-6 px-6">{loadError}</p>
            )}
            {!loading && !loadError && (
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
                <Link
                  href={`/bird/${encodeURIComponent(s.name)}`}
                  key={s.name}
                  className="rounded-2xl overflow-hidden border-[3px] border-cardBorder bg-white relative block hover:border-accent transition-colors"
                >
                  {s.imageUrl ? (
                    <div className="aspect-square">
                      <img
                        src={s.imageUrl}
                        alt={s.name}
                        className="w-full h-full object-cover"
                      />
                    </div>
                  ) : (
                    <div
                      className="aspect-square flex items-center justify-center text-3xl"
                      style={{ backgroundColor: PLACEHOLDER_COLOR }}
                    >
                      {PLACEHOLDER_EMOJI}
                    </div>
                  )}
                  <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-[10px] font-bold text-center py-1.5">
                    {s.name}
                  </div>
                </Link>
              ))}
              {visible.length === 0 && (
                <div className="col-span-3 text-center text-xs text-inkMuted py-6">
                  この信頼度以上の記録は見つかりませんでした
                </div>
              )}
            </div>
            </>
            )}
          </>
        ) : (
          <div className="px-4 pt-4 pb-5">
            {loading && (
              <p className="text-center text-xs text-inkMuted py-6">読み込み中...</p>
            )}
            {!loading &&
              locations.map((loc) => (
                <div
                  key={loc.name}
                  className="w-full flex items-center gap-3 bg-white border-[3px] border-cardBorder rounded-2xl p-3 mb-3"
                >
                  <div
                    className="w-11 h-11 rounded-full flex items-center justify-center text-xl flex-shrink-0 border-[3px] border-white shadow-[0_0_0_2px_#B4CF9E]"
                    style={{ backgroundColor: PLACEHOLDER_COLOR }}
                  >
                    📍
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-display text-base">{loc.name}</div>
                    <div className="text-[11px] text-inkMuted font-bold mt-0.5">
                      検出種数 {loc.speciesCount}・記録数 {loc.recordCount}件・最終観測{" "}
                      {loc.lastSeen}
                    </div>
                  </div>
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}
