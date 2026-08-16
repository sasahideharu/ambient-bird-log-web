"use client";

import { useEffect, useState } from "react";
import { fetchSpeciesDetail } from "../lib/speciesDetail";
import { getAudioUrl } from "../lib/queries";
import MinimalSpectrogram from "./MinimalSpectrogram";

const CONFIDENCE_DEFAULT = 60;

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
        className={`relative rounded-[28px] overflow-hidden bg-black/40 backdrop-blur-2xl border border-white/15 transition-all duration-500 ${
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

        <div className="w-full h-full overflow-y-auto px-6 pt-14 pb-12 flex flex-col items-center">
          {loading && <p className="text-white/50 text-xs py-16">…</p>}

          {!loading && detail && (
            <>
              {/* 表示内容1：学名（小）・和名（大） */}
              <div className="italic text-white/70 text-xs text-center">
                {detail.scientificName}
              </div>
              <div className="font-hero text-white text-3xl text-center mt-1">
                {detail.name}
              </div>

              {/* 表示内容2：野鳥の画像 */}
              {detail.imageUrl && (
                <img
                  src={detail.imageUrl}
                  alt={detail.name}
                  className="w-full rounded-2xl mt-6 object-cover"
                />
              )}

              {/* 表示内容3：音声データ（スペクトログラム＋再生） */}
              <div className="w-full flex flex-col gap-6 mt-8">
                {records.map((r) => (
                  <MinimalSpectrogram
                    key={r.id}
                    src={getAudioUrl(r.wavFilename)}
                    startSec={r.startSec}
                    endSec={r.endSec}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
