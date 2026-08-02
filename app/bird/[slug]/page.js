"use client";

import { useState, useEffect, useMemo, use } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { fetchSpeciesDetail } from "../../../lib/speciesDetail";

const PLACEHOLDER_COLOR = "#C7D3C9";
const PLACEHOLDER_EMOJI = "🐦";

function Spectrogram({ seed = 0 }) {
  // 🔥 実装後はBirdNETの解析結果から生成した実際のスペクトログラム画像に置き換える
  const gradId = `spec-${seed}`;
  return (
    <svg width="120" height="30" viewBox="0 0 120 30" className="rounded-md flex-shrink-0">
      <rect width="120" height="30" fill="#150603" />
      <defs>
        <radialGradient id={gradId} cx="30%" cy="75%" r="55%">
          <stop offset="0%" stopColor="#FCFFA4" />
          <stop offset="35%" stopColor="#F1605D" />
          <stop offset="70%" stopColor="#84206B" />
          <stop offset="100%" stopColor="#150603" stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse cx="22" cy="21" rx="16" ry="4" fill={`url(#${gradId})`} opacity="0.9" transform="rotate(-14 22 21)" />
      <ellipse cx="55" cy="12" rx="20" ry="3.5" fill={`url(#${gradId})`} opacity="0.85" transform="rotate(-20 55 12)" />
      <ellipse cx="92" cy="6" rx="16" ry="3" fill={`url(#${gradId})`} opacity="0.75" transform="rotate(-26 92 6)" />
    </svg>
  );
}

export default function BirdDetailPage({ params }) {
  const { slug } = use(params);
  const commonName = decodeURIComponent(slug);

  const [bird, setBird] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [minConfidence, setMinConfidence] = useState(50);

  useEffect(() => {
    async function load() {
      try {
        const result = await fetchSpeciesDetail(commonName);
        if (!result) {
          notFound();
          return;
        }
        setBird(result);
      } catch (err) {
        console.error(err);
        setLoadError("データの取得に失敗しました。");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [commonName]);

  const visibleRecords = useMemo(() => {
    if (!bird) return [];
    return bird.records.filter((r) => r.confidence >= minConfidence);
  }, [bird, minConfidence]);

  const avgConfidence = useMemo(() => {
    if (!bird || bird.records.length === 0) return 0;
    return Math.round(
      bird.records.reduce((sum, r) => sum + r.confidence, 0) / bird.records.length
    );
  }, [bird]);

  return (
    <div className="min-h-screen w-full flex justify-center bg-page p-6">
      <div className="w-full max-w-sm bg-page rounded-[28px] border-[6px] border-white shadow-xl overflow-hidden">
        <Link href="/" className="block px-4 pt-4 text-xs font-bold text-[#6B7A72]">
          ‹ 種目録に戻る
        </Link>

        {loading && <p className="text-center text-xs text-inkMuted py-10">読み込み中...</p>}
        {loadError && <p className="text-center text-xs text-red-500 py-10 px-6">{loadError}</p>}

        {!loading && !loadError && bird && (
          <>
            {/* バナー */}
            <div className="mx-4 mt-2.5 mb-3 bg-white border-[3px] border-cardBorder rounded-2xl p-4 flex gap-3.5 items-center">
              {bird.imageUrl ? (
                <img
                  src={bird.imageUrl}
                  alt={bird.name}
                  className="w-[72px] h-[72px] rounded-full object-cover flex-shrink-0 border-[3px] border-white shadow-[0_0_0_2px_#B4CF9E]"
                />
              ) : (
                <div
                  className="w-[72px] h-[72px] rounded-full flex items-center justify-center text-4xl flex-shrink-0 border-[3px] border-white shadow-[0_0_0_2px_#B4CF9E]"
                  style={{ backgroundColor: PLACEHOLDER_COLOR }}
                >
                  {PLACEHOLDER_EMOJI}
                </div>
              )}
              <div>
                <div className="italic text-[11px] text-inkMuted">{bird.scientificName}</div>
                <div className="font-display text-xl my-0.5">{bird.name}</div>
              </div>
            </div>

            {/* サマリー */}
            <div className="grid grid-cols-3 gap-2 mx-4 mb-3.5">
              <div className="bg-white border-[3px] border-cardBorder rounded-2xl text-center py-2">
                <div className="font-display text-base text-accentText">{bird.records.length}</div>
                <div className="text-[9px] text-inkMuted font-bold">検出回数</div>
              </div>
              <div className="bg-white border-[3px] border-cardBorder rounded-2xl text-center py-2">
                <div className="font-display text-base text-accentText">{avgConfidence}%</div>
                <div className="text-[9px] text-inkMuted font-bold">平均信頼度</div>
              </div>
              <div className="bg-white border-[3px] border-cardBorder rounded-2xl text-center py-2">
                <div className="font-display text-base text-accentText">{bird.locationCount}</div>
                <div className="text-[9px] text-inkMuted font-bold">観測地点</div>
              </div>
            </div>

            {/* 信頼度フィルタ */}
            <div className="mx-4 mb-3.5 bg-white border-[3px] border-cardBorder rounded-2xl px-4 py-3">
              <label className="text-xs font-bold text-ink">
                信頼度フィルタ：<span className="text-accentText font-black">{minConfidence}%</span>以上を表示
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

            {/* 検出記録リスト */}
            <div className="px-4 pb-5 flex flex-col gap-3">
              {visibleRecords.map((r) => (
                <div key={r.id} className="bg-white border-[3px] border-cardBorder rounded-2xl p-3.5">
                  <div className="flex justify-between items-baseline mb-2">
                    <div className="text-[10px] tracking-wide text-accentText font-black">
                      標本記録 No. {r.id}
                    </div>
                    <div className="text-[11px] text-[#6B7A72] font-bold">識別信頼度 {r.confidence}%</div>
                  </div>
                  <div className="flex gap-3 items-center">
                    <Spectrogram seed={r.id} />
                    <button
                      aria-label="再生"
                      className="w-9 h-9 rounded-full bg-accent flex items-center justify-center text-white text-sm flex-shrink-0 shadow-[0_3px_0_#7E916F]"
                    >
                      ▶
                    </button>
                  </div>
                  <div className="flex gap-1.5 mt-2">
                    <span className="text-[10px] font-bold bg-page border-2 border-cardBorder rounded-lg px-2 py-1">
                      📅 {r.date}
                    </span>
                    <span className="text-[10px] font-bold bg-page border-2 border-cardBorder rounded-lg px-2 py-1">
                      📍 {r.location}
                    </span>
                    <span className="text-[10px] font-bold bg-page border-2 border-cardBorder rounded-lg px-2 py-1">
                      🕒 {r.time}
                    </span>
                  </div>
                </div>
              ))}
              {visibleRecords.length === 0 && (
                <div className="text-center text-xs text-inkMuted py-6">
                  この信頼度以上の記録は見つかりませんでした
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
