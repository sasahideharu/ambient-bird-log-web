"use client";

import { useState, useEffect, useMemo, use } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { fetchLocationDetail } from "../../../lib/locationDetail";
import { getAudioUrl } from "../../../lib/queries";
import AudioSpectrogramCard from "../../../components/AudioSpectrogramCard";
import dynamic from "next/dynamic";

// 🔥 Leafletはブラウザ専用のためSSRを無効化して読み込む
const LocationMap = dynamic(() => import("../../../components/LocationMap"), {
  ssr: false,
  loading: () => (
    <div className="mx-4 mb-3 rounded-2xl border-[3px] border-cardBorder bg-white h-32 flex items-center justify-center text-xs text-inkMuted">
      地図を読み込み中...
    </div>
  ),
});

export default function LocationDetailPage({ params }) {
  const { name } = use(params);
  const locationName = decodeURIComponent(name);

  const [loc, setLoc] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [minConfidence, setMinConfidence] = useState(50);

  useEffect(() => {
    async function load() {
      try {
        const result = await fetchLocationDetail(locationName);
        if (!result) {
          notFound();
          return;
        }
        setLoc(result);
      } catch (err) {
        console.error(err);
        setLoadError("データの取得に失敗しました。");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [locationName]);

  const visibleRecords = useMemo(() => {
    if (!loc) return [];
    return loc.records.filter((r) => r.confidence >= minConfidence);
  }, [loc, minConfidence]);

  return (
    <div className="min-h-screen w-full flex justify-center bg-page p-6">
      <div className="w-full max-w-sm bg-page rounded-[28px] border-[6px] border-white shadow-xl overflow-hidden">
        <Link href="/" className="block px-4 pt-4 text-xs font-bold text-[#3F6C74]">
          ‹ 観測地点に戻る
        </Link>

        {loading && <p className="text-center text-xs text-inkMuted py-10">読み込み中...</p>}
        {loadError && <p className="text-center text-xs text-red-500 py-10 px-6">{loadError}</p>}

        {!loading && !loadError && loc && (
          <>
            <div className="mx-4 mt-2.5 mb-3 bg-white border-[3px] border-cardBorder rounded-2xl p-4 flex gap-3.5 items-center">
              <div
                className="w-[60px] h-[60px] rounded-full flex items-center justify-center text-3xl flex-shrink-0 border-[3px] border-white shadow-[0_0_0_2px_#8FC2CB]"
                style={{ backgroundColor: "#F6E1E4" }}
              >
                📍
              </div>
              <div>
                <div className="font-display text-xl">{loc.name}</div>
                <div className="text-[11px] text-inkMuted font-bold">
                  検出種数 {loc.speciesCount}・記録数 {loc.records.length}件
                </div>
              </div>
            </div>

            {loc.latitude != null && loc.longitude != null && (
              <LocationMap
                locations={[
                  {
                    name: loc.name,
                    latitude: loc.latitude,
                    longitude: loc.longitude,
                    speciesCount: loc.speciesCount,
                    recordCount: loc.records.length,
                    lastSeen: loc.lastSeen,
                  },
                ]}
              />
            )}

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
                  background: `linear-gradient(to right, #8FC2CB ${minConfidence}%, #E9E6E1 ${minConfidence}%)`,
                }}
              />
            </div>

            <div className="px-4 pb-5 flex flex-col gap-3">
              {visibleRecords.map((r) => {
                const audioUrl = getAudioUrl(r.wavFilename);
                return (
                  <div key={r.id} className="bg-white border-[3px] border-cardBorder rounded-2xl p-3.5">
                    <div className="flex justify-between items-baseline mb-2">
                      <div className="text-[10px] tracking-wide text-accentText font-black">
                        {r.species}
                      </div>
                      <div className="text-[11px] text-[#3F6C74] font-bold">識別信頼度 {r.confidence}%</div>
                    </div>
                    <AudioSpectrogramCard src={audioUrl} startSec={r.startSec} endSec={r.endSec} />
                    <div className="flex gap-1.5 mt-2">
                      <span className="text-[10px] font-bold bg-page border-2 border-cardBorder rounded-lg px-2 py-1">
                        📅 {r.date}
                      </span>
                      <span className="text-[10px] font-bold bg-page border-2 border-cardBorder rounded-lg px-2 py-1">
                        🕒 {r.time}
                      </span>
                    </div>
                  </div>
                );
              })}
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
