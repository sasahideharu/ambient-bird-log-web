"use client";

import { useState, useEffect, useLayoutEffect, useMemo } from "react";
import Image from "next/image";
import { fetchDetections, fetchBirdImages } from "../lib/queries";
import { buildSpeciesList } from "../lib/aggregate";
import {
  getSessionOrderMap,
  setSessionOrderMap,
  sortWithFixedTail,
} from "../lib/speciesOrder";
import MinimalBirdModal from "./MinimalBirdModal";

const CONFIDENCE_DEFAULT = 60;

// 🔥 写真グリッドの1枚分。読み込みに失敗したら、写真なしの縁取りだけのマスに切り替える（admin版と同じ考え方）
function MinimalThumb({ species: s, onSelect }) {
  const [imgFailed, setImgFailed] = useState(false);
  const showImage = s.imageUrl && !imgFailed;

  return (
    <button
      onClick={() => onSelect(s.name)}
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
    </button>
  );
}

export default function MinimalHome() {
  const [rawDetections, setRawDetections] = useState([]);
  const [birdImages, setBirdImages] = useState([]);
  const [keyword, setKeyword] = useState("");

  const [bgRevealed, setBgRevealed] = useState(false);
  const [contentRevealed, setContentRevealed] = useState(false);
  const [bgHeight, setBgHeight] = useState(null);
  const [selectedSpecies, setSelectedSpecies] = useState(null);
  const [orderMap, setOrderMap] = useState(() => ({ ...getSessionOrderMap() }));

  // 🔥 InstagramやLINEのアプリ内ブラウザは、スクロール中にアドレスバーが伸び縮みして
  //    100vh/100lvhの値がその都度変わってしまい、背景がズームして見えてしまう。
  //    なので、最初に一度だけ画面の高さを測って固定値（px）として使い、以後は測り直さない。
  //    後からアドレスバーが縮んで表示領域が広がっても隙間ができないよう、余裕を持たせておく。
  useLayoutEffect(() => {
    if (typeof window === "undefined") return;
    setBgHeight(window.innerHeight + 160);
  }, []);

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

  // 🔥 データが読み込まれたら、まだ順番が決まっていない鳥にだけ新しくランダムな順位を割り当てて保存する
  //    （AdminHomeと同じsessionOrderMapを参照するので、両画面で同じ並びになる）
  useEffect(() => {
    if (rawDetections.length === 0) return;
    const allSpecies = buildSpeciesList(rawDetections, birdImages);
    setOrderMap((prev) => {
      const next = { ...getSessionOrderMap(), ...prev };
      let changed = false;
      for (const s of allSpecies) {
        if (!(s.name in next)) {
          next[s.name] = Math.random();
          changed = true;
        }
      }
      if (changed) setSessionOrderMap(next);
      return changed ? next : prev;
    });
  }, [rawDetections, birdImages]);

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
    const keywordFiltered = speciesList.filter(
      (s) => keyword.trim() === "" || s.name.includes(keyword.trim())
    );
    return sortWithFixedTail(keywordFiltered, orderMap);
  }, [rawDetections, birdImages, keyword, orderMap]);

  return (
    <div className="relative w-full bg-black">
      {/* 背景：sticky + 負のマージンで「固定に見える」ようにする。
          position: fixed だとAndroidのChromeでアドレスバーの伸縮時に位置がズレることがあるため、
          スクロールの動きに素直に追従するstickyの方が両OSで安定する */}
      <div
        className={`sticky top-0 w-full z-0 ${
          bgRevealed ? "opacity-100 brightness-100 saturate-100" : "opacity-0 brightness-[0.35] saturate-[0.55]"
        }`}
        style={{
          transition: "opacity 2600ms ease-out, filter 2600ms ease-out",
          height: bgHeight ? `${bgHeight}px` : "100vh",
          marginBottom: bgHeight ? `-${bgHeight}px` : "-100vh",
        }}
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
          className={`abl-fade ${contentRevealed ? "abl-fade-in" : ""} font-hero text-[#F4F2EC] text-center mt-2`}
          style={{ transitionDelay: "900ms" }}
        >
          <span className="block text-[10px] tracking-[2px]">by Hideharu Sasa</span>
          <span className="block text-[7px] tracking-[1.5px] mt-1 opacity-80">from Angle Matters</span>
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
            <MinimalThumb key={s.name} species={s} onSelect={setSelectedSpecies} />
          ))}
          {visible.length === 0 && (
            <p className="col-span-3 text-center text-white/50 text-xs py-4">
              該当する野鳥が見つかりませんでした
            </p>
          )}
        </div>
      </div>

      <MinimalBirdModal
        speciesName={selectedSpecies}
        onClose={() => setSelectedSpecies(null)}
      />
    </div>
  );
}
