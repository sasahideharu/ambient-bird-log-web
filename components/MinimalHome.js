"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import Image from "next/image";
import { fetchDetections, fetchBirdImages } from "../lib/queries";
import { buildSpeciesList } from "../lib/aggregate";

const CONFIDENCE_DEFAULT = 60;

// 🔥 写真グリッドの1枚分。読み込みに失敗したら、写真なしの縁取りだけのマスに切り替える（admin版と同じ考え方）
function MinimalThumb({ species: s }) {
  const [imgFailed, setImgFailed] = useState(false);
  const showImage = s.imageUrl && !imgFailed;

  return (
    <Link
      href={`/bird/${encodeURIComponent(s.name)}`}
      className="rounded-xl overflow-hidden border border-white/50 hover:border-white relative block transition-colors bg-white/5"
    >
      <div className="aspect-square">
        {showImage ? (
          <img
            src={s.imageUrl}
            alt={s.name}
            loading="lazy"
            onError={() => setImgFailed(true)}
            className="w-full h-full object-cover"
          />
        ) : null}
      </div>
      <div className="absolute bottom-0 left-0 right-0 bg-black/50 backdrop-blur-[1px] text-white text-[10px] font-medium tracking-wide text-center py-1.5">
        {s.name}
      </div>
    </Link>
  );
}

export default function MinimalHome() {
  const [rawDetections, setRawDetections] = useState([]);
  const [birdImages, setBirdImages] = useState([]);
  const [keyword, setKeyword] = useState("");

  const [bgRevealed, setBgRevealed] = useState(false);
  const [contentRevealed, setContentRevealed] = useState(false);

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
      }
    }
    load();
  }, []);

  useEffect(() => {
    const t1 = setTimeout(() => setBgRevealed(true), 80);
    const t2 = setTimeout(() => setContentRevealed(true), 650);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, []);

  const visible = useMemo(() => {
    const filteredDetections = rawDetections.filter(
      (d) => Math.round(d.confidence * 100) >= CONFIDENCE_DEFAULT
    );
    const speciesList = buildSpeciesList(filteredDetections, birdImages);
    return speciesList
      .filter((s) => keyword.trim() === "" || s.name.includes(keyword.trim()))
      .sort((a, b) => a.name.localeCompare(b.name, "ja"));
  }, [rawDetections, birdImages, keyword]);

  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-black">
      {/* 背景：暗めからスーッと本来の色に */}
      <div
        className={`absolute inset-0 transition-all ease-out ${
          bgRevealed ? "opacity-100 brightness-100 saturate-100" : "opacity-0 brightness-[0.35] saturate-[0.55]"
        }`}
        style={{ transitionDuration: "2600ms" }}
      >
        <Image
          src="/forest-bg.jpg"
          alt=""
          fill
          priority
          sizes="100vw"
          className="object-cover"
        />
        <div className="absolute inset-0 bg-black/25" />
      </div>

      {/* コンテンツ */}
      <div className="relative z-10 min-h-screen w-full flex flex-col items-center px-6 pt-14 pb-10">
        <h1
          className={`abl-fade ${contentRevealed ? "abl-fade-in" : ""} font-hero font-light text-white text-3xl tracking-wide text-center`}
          style={{ transitionDelay: "300ms" }}
        >
          Ambient Bird Log
        </h1>
        <p
          className={`abl-fade ${contentRevealed ? "abl-fade-in" : ""} font-hero text-[#F4F2EC] text-[10px] tracking-[2px] text-center mt-2`}
          style={{ transitionDelay: "900ms" }}
        >
          by Hideharu Sasa
        </p>

        <div
          className={`abl-fade ${contentRevealed ? "abl-fade-in" : ""} w-full max-w-sm mt-10`}
          style={{ transitionDelay: "1500ms" }}
        >
          <input
            type="text"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="What bird sings now?"
            className="w-full bg-white/10 backdrop-blur-sm border border-white/40 rounded-full px-5 py-3 text-white text-sm text-center placeholder:text-white/50 outline-none focus:border-white/80 transition-colors"
          />
        </div>

        <div
          className={`abl-fade ${contentRevealed ? "abl-fade-in" : ""} w-full max-w-sm mt-6 grid grid-cols-3 gap-2`}
          style={{ transitionDelay: "1800ms" }}
        >
          {visible.map((s) => (
            <MinimalThumb key={s.name} species={s} />
          ))}
          {visible.length === 0 && (
            <p className="col-span-3 text-center text-white/50 text-xs py-4">
              該当する野鳥が見つかりませんでした
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
