"use client";

import { useState, useMemo, useEffect } from "react";
import Link from "next/link";
import { fetchDetections, fetchBirdImages } from "../lib/queries";
import { buildSpeciesList, buildLocationList, buildDateList } from "../lib/aggregate";
import dynamic from "next/dynamic";

// 🔥 Leafletはブラウザ専用（windowが必要）のためSSRを無効化して読み込む
const LocationMap = dynamic(() => import("../components/LocationMap"), {
  ssr: false,
  loading: () => (
    <div className="mx-4 mb-4 rounded-2xl border-[3px] border-cardBorder bg-white h-40 flex items-center justify-center text-xs text-inkMuted">
      地図を読み込み中...
    </div>
  ),
});

// 🔥 写真がまだ登録されていない鳥のプレースホルダー色（絵文字はひとまず共通）
const PLACEHOLDER_COLOR = "#F6E1E4";
const PLACEHOLDER_EMOJI = "🐦";

// 🔥 種の並び順を、このページを開いている間（＝ページ内遷移をしている間）だけ覚えておく。
//    モジュールスコープの変数なので、Next.js内のページ遷移（Linkでの移動）では保持されるが、
//    ブラウザの本当のリロードが起きるとJSごと再読み込みされてリセットされる
let sessionOrderMap = {};

// 🔥 写真グリッドの1枚分。読み込みに失敗したら絵文字プレースホルダーに切り替える
function SpeciesThumb({ species: s }) {
  const [imgFailed, setImgFailed] = useState(false);
  const showImage = s.imageUrl && !imgFailed;

  return (
    <Link
      href={`/bird/${encodeURIComponent(s.name)}`}
      className="rounded-2xl overflow-hidden border-[3px] border-cardBorder bg-white relative block hover:border-accent transition-colors"
    >
      {showImage ? (
        <div className="aspect-square bg-page">
          <img
            src={s.imageUrl}
            alt={s.name}
            loading="lazy"
            onError={() => setImgFailed(true)}
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
  );
}

export default function HomePage() {
  const [activeTab, setActiveTab] = useState("species");
  const [minConfidence, setMinConfidence] = useState(60);
  const [keyword, setKeyword] = useState("");

  const [rawDetections, setRawDetections] = useState([]);
  const [birdImages, setBirdImages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [orderMap, setOrderMap] = useState(() => ({ ...sessionOrderMap }));

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

  // 🔥 データが読み込まれたら、まだ順番が決まっていない鳥にだけ新しくランダムな順位を割り当てて保存する
  //    （信頼度フィルタの影響を受けない、全種を対象にすることで、フィルタを動かしても既存の順番が崩れないようにする）
  useEffect(() => {
    if (rawDetections.length === 0) return;
    const allSpecies = buildSpeciesList(rawDetections, birdImages);
    setOrderMap((prev) => {
      const next = { ...sessionOrderMap, ...prev };
      let changed = false;
      for (const s of allSpecies) {
        if (!(s.name in next)) {
          next[s.name] = Math.random();
          changed = true;
        }
      }
      if (changed) sessionOrderMap = next;
      return changed ? next : prev;
    });
  }, [rawDetections, birdImages]);

  // 🔥 「信頼度○%以上の記録が1件でもあれば、その鳥を種目録に出す」という判定にするため、
  //    先に記録を信頼度で絞り込んでから、鳥ごとに集計する
  const visible = useMemo(() => {
    const filteredDetections = rawDetections.filter(
      (d) => Math.round(d.confidence * 100) >= minConfidence
    );
    const speciesList = buildSpeciesList(filteredDetections, birdImages);
    const keywordFiltered = speciesList.filter(
      (s) => keyword.trim() === "" || s.name.includes(keyword.trim())
    );

    // 🔥 ヒヨドリ・ガビチョウ以外は保存済みの順番で並べ、この2種は必ず最後（ヒヨドリ→ガビチョウ）に固定する
    const FIXED_TAIL_ORDER = ["ヒヨドリ", "ガビチョウ"];
    const rest = keywordFiltered
      .filter((s) => !FIXED_TAIL_ORDER.includes(s.name))
      .slice()
      .sort((a, b) => (orderMap[a.name] ?? 0.5) - (orderMap[b.name] ?? 0.5));
    const fixedTail = FIXED_TAIL_ORDER.map((name) =>
      keywordFiltered.find((s) => s.name === name)
    ).filter(Boolean);

    return [...rest, ...fixedTail];
  }, [rawDetections, birdImages, minConfidence, keyword, orderMap]);

  const locations = useMemo(() => buildLocationList(rawDetections), [rawDetections]);
  const dates = useMemo(() => buildDateList(rawDetections), [rawDetections]);

  return (
    <div className="min-h-screen w-full flex justify-center bg-page p-6">
      <div className="w-full max-w-sm bg-page rounded-[28px] border-[6px] border-white shadow-xl overflow-hidden">
        {/* ヘッダーバナー */}
        <div className="bg-header px-6 pt-6 pb-6 rounded-b-3xl">
          <h1 className="font-display text-[#5C5750] text-2xl">
            🎧 Ambient Bird Log 🐦
          </h1>
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
            🐦 鳥から探す
          </button>
          <button
            onClick={() => setActiveTab("location")}
            className={`pb-2 mr-6 text-sm font-bold border-b-[3px] transition-colors ${
              activeTab === "location"
                ? "text-ink border-accentText"
                : "text-inkMuted border-transparent"
            }`}
          >
            📍 観測地点
          </button>
          <button
            onClick={() => setActiveTab("date")}
            className={`pb-2 text-sm font-bold border-b-[3px] transition-colors ${
              activeTab === "date"
                ? "text-ink border-accentText"
                : "text-inkMuted border-transparent"
            }`}
          >
            📅 観測日
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
                  background: `linear-gradient(to right, #8FC2CB ${minConfidence}%, #E9E6E1 ${minConfidence}%)`,
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
                className="w-full px-4 py-2.5 rounded-2xl border-[3px] border-cardBorder bg-white text-sm text-ink placeholder:text-[#9C978F] outline-none focus:border-accent"
              />
            </div>

            {/* 写真グリッド */}
            <div className="grid grid-cols-3 gap-2 px-4 pt-4 pb-5">
              {visible.map((s) => (
                <SpeciesThumb key={s.name} species={s} />
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
        ) : activeTab === "location" ? (
          <div className="pt-4 pb-5">
            {!loading && !loadError && locations.length > 0 && (
              <LocationMap locations={locations} />
            )}
            <div className="px-4">
            {loading && (
              <p className="text-center text-xs text-inkMuted py-6">読み込み中...</p>
            )}
            {!loading &&
              locations.map((loc) => (
                <Link
                  href={`/loc/${encodeURIComponent(loc.name)}`}
                  key={loc.name}
                  className="w-full flex items-center gap-3 bg-white border-[3px] border-cardBorder rounded-2xl p-3 mb-3 hover:border-accent transition-colors"
                >
                  <div
                    className="w-11 h-11 rounded-full flex items-center justify-center text-xl flex-shrink-0 border-[3px] border-white shadow-[0_0_0_2px_#8FC2CB]"
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
                  <div className="text-accentText text-base">›</div>
                </Link>
              ))}
            </div>
          </div>
        ) : (
          <div className="px-4 pt-4 pb-5">
            {loading && (
              <p className="text-center text-xs text-inkMuted py-6">読み込み中...</p>
            )}
            {!loading &&
              dates.map((d) => (
                <Link
                  href={`/date/${d.isoDate}`}
                  key={d.isoDate}
                  className="w-full flex items-center gap-3 bg-white border-[3px] border-cardBorder rounded-2xl p-3 mb-3 hover:border-accent transition-colors"
                >
                  <div className="w-11 h-11 rounded-xl bg-[#E6DEEC] border-[3px] border-white shadow-[0_0_0_2px_#C7B8D2] flex flex-col items-center justify-center flex-shrink-0">
                    <div className="font-display text-sm">{d.date}</div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-display text-base">{d.date}</div>
                    <div className="text-[11px] text-inkMuted font-bold mt-0.5">
                      検出種数 {d.speciesCount}・記録数 {d.recordCount}件・{d.locations}
                    </div>
                  </div>
                  <div className="text-accentText text-base">›</div>
                </Link>
              ))}
            {!loading && dates.length === 0 && (
              <p className="text-center text-xs text-inkMuted py-6">観測記録がありません</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}