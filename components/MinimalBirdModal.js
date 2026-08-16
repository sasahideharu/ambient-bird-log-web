"use client";

import { useEffect, useState } from "react";
import { fetchSpeciesDetail } from "../lib/speciesDetail";
import { getAudioUrl } from "../lib/queries";
import MinimalSpectrogram from "./MinimalSpectrogram";

const CONFIDENCE_DEFAULT = 60;

// "2026-08-01" のようなISO日付を "August 2026" のような表記に変換する
function formatMonthYear(isoDate) {
  if (!isoDate) return null;
  const d = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

export default function MinimalBirdModal({ speciesName, onClose }) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!speciesName) return;
    let cancelled = false;
    setDetail(null);
    setLoading(true);
    setVisible(false);

    fetchSpeciesDetail(speciesName)
      .then((result) => {
        if (!cancelled) setDetail(result);
      })
      .catch((err) => console.error(err))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    const t = setTimeout(() => setVisible(true), 30);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [speciesName]);

  if (!speciesName) return null;

  // 🔥 信頼度60%以上だけを対象に、信頼度が高い順（同着は新しい記録を上に）で並べる
  const records = detail
    ? detail.records
        .filter((r) => r.confidence >= CONFIDENCE_DEFAULT)
        .slice()
        .sort((a, b) => b.confidence - a.confidence)
    : [];

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center transition-opacity duration-500 ${
        visible ? "opacity-100" : "opacity-0"
      }`}
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/70" />

      <div
        className={`relative rounded-[28px] overflow-hidden bg-black/15 backdrop-blur-2xl border border-white/15 transition-all duration-500 ${
          visible ? "opacity-100 scale-100" : "opacity-0 scale-95"
        }`}
        style={{ width: "90vw", height: "90vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          aria-label="閉じる"
          className="absolute top-4 right-4 z-20 w-9 h-9 rounded-full bg-black/30 text-white text-lg flex items-center justify-center"
        >
          ×
        </button>

        {loading && (
          <p className="text-white/50 text-xs text-center py-16">…</p>
        )}

        {!loading && detail && (
          <div className="w-full h-full flex flex-col">
            {/* 固定ヘッダー：学名・和名・画像はスクロールしない */}
            <div className="flex-shrink-0 px-6 pt-14 pb-4 flex flex-col items-center">
              <div className="italic text-white/70 text-xs text-center">
                {detail.scientificName}
              </div>
              <div className="font-hero text-white text-3xl text-center mt-1">
                {detail.name}
              </div>
              {detail.imageUrl && (
                <img
                  src={detail.imageUrl}
                  alt={detail.name}
                  className="w-full rounded-2xl mt-4 object-cover"
                  style={{ maxHeight: "26vh" }}
                />
              )}
            </div>

            {/* スクロール領域：音声データだけがここで動く */}
            <div className="flex-1 overflow-y-auto px-6 pb-10 flex flex-col gap-7">
              {records.map((r) => {
                const caption = [formatMonthYear(r.isoDate), r.location]
                  .filter(Boolean)
                  .join(" · ");
                return (
                  <div key={r.id}>
                    {caption && (
                      <div className="text-[10px] text-white/50 tracking-wide mb-1.5">
                        {caption}
                      </div>
                    )}
                    <MinimalSpectrogram
                      src={getAudioUrl(r.wavFilename)}
                      startSec={r.startSec}
                      endSec={r.endSec}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
