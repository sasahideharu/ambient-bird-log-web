"use client";

import { useState, useMemo, useEffect } from "react";
import Link from "next/link";
import { fetchDetections, fetchBirdImages } from "../lib/queries";
import { buildSpeciesList, buildLocationList, buildDateList } from "../lib/aggregate";
import {
  getSessionOrderMap,
  setSessionOrderMap,
  sortWithFixedTail,
} from "../lib/speciesOrder";
import dynamic from "next/dynamic";
import { useSystemBars } from "../lib/useSystemBars";
import { countRejectedRemote } from "../lib/verifications";
import ImportSection from "./ImportSection";

// 🔥 Leafletはブラウザ専用（windowが必要）のためSSRを無効化して読み込む
const LocationMap = dynamic(() => import("./LocationMap"), {
  ssr: false,
  loading: () => (
    <div className="mx-4 mb-4 rounded-2xl border-[3px] border-cardBorder bg-white h-40 flex items-center justify-center text-xs text-inkMuted">
      地図を読み込み中...
    </div>
  ),
});

const TABS = [
  { id: "species", icon: "🐦", label: "鳥から探す" },
  { id: "location", icon: "📍", label: "観測地点" },
  { id: "date", icon: "📅", label: "観測日" },
  { id: "import", icon: "📥", label: "データ登録" },
];

// 🔥 写真がまだ登録されていない鳥のプレースホルダー色（絵文字はひとまず共通）
const PLACEHOLDER_COLOR = "#F6E1E4";
const PLACEHOLDER_EMOJI = "🐦";

// 🔥 写真グリッドの1枚分。読み込みに失敗したら絵文字プレースホルダーに切り替える
function SpeciesThumb({ species: s }) {
  const [imgFailed, setImgFailed] = useState(false);
  const showImage = s.imageUrl && !imgFailed;

  return (
    <Link
      href={`/bird?name=${encodeURIComponent(s.name)}`}
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

export default function AdminHome() {
  useSystemBars("light"); // 明るい背景：バーの文字は黒
  const [activeTab, setActiveTab] = useState("species");
  const [importOpened, setImportOpened] = useState(false); // データ登録タブは、初めて開いたときに読み込み、以後は残す（選んだファイルを失わないため）
  const [minConfidence, setMinConfidence] = useState(60);
  const [keyword, setKeyword] = useState("");

  const [rawDetections, setRawDetections] = useState([]);
  const [birdImages, setBirdImages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [orderMap, setOrderMap] = useState(() => ({ ...getSessionOrderMap() }));
  const [rejectedCount, setRejectedCount] = useState(0); // 除外した記録の件数（あるときだけ入口を出す）

  useEffect(() => {
    countRejectedRemote().then(setRejectedCount);
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

    return sortWithFixedTail(keywordFiltered, orderMap);
  }, [rawDetections, birdImages, minConfidence, keyword, orderMap]);

  const locations = useMemo(() => buildLocationList(rawDetections), [rawDetections]);
  const dates = useMemo(() => buildDateList(rawDetections), [rawDetections]);

  return (
    <div className="abl-page-safe min-h-screen w-full flex justify-center bg-page px-6">
      <div className="w-full max-w-sm bg-page rounded-[28px] border-[6px] border-white shadow-xl overflow-hidden">
        {/* ヘッダーバナー */}
        <div className="bg-header px-6 pt-6 pb-6 rounded-b-3xl">
          <Link href="/" className="block mb-2 text-xs font-bold text-[#3F6C74]">
            ‹ ホームへ戻る
          </Link>
          <h1 className="font-display text-[#5C5750] text-2xl">
            🎧 Ambient Bird Log 🐦
          </h1>
        </div>

        {/* タブ（4つ全部が、スマホの幅でも見えるよう、絵文字を上・文字を下の2段にする） */}
        <div className="flex px-3 pt-3 border-b border-cardBorder">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => {
                setActiveTab(t.id);
                if (t.id === "import") setImportOpened(true);
              }}
              className={`flex-1 pb-2 flex flex-col items-center gap-0.5 text-[11px] font-bold border-b-[3px] transition-colors ${
                activeTab === t.id ? "text-ink border-accentText" : "text-inkMuted border-transparent"
              }`}
            >
              <span className="text-base leading-none">{t.icon}</span>
              <span className="whitespace-nowrap">{t.label}</span>
            </button>
          ))}
        </div>

        {/* データ登録は、初めて開いたときだけ読み込み、他のタブに移っても消さない */}
        {importOpened && (
          <div className={activeTab === "import" ? "" : "hidden"}>
            <ImportSection />
          </div>
        )}

        {activeTab === "import" ? null : activeTab === "species" ? (
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
                  href={`/loc?name=${encodeURIComponent(loc.name)}`}
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
                  href={`/date?value=${d.isoDate}`}
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

        <div className="mx-4 mb-5 flex flex-col gap-2.5">
          {rejectedCount > 0 && (
            <Link
              href="/rejected"
              className="flex items-center justify-between rounded-2xl border-[3px] border-cardBorder bg-white px-4 py-3 text-xs font-bold text-[#3F6C74] hover:border-accent transition-colors"
            >
              <span>除外した記録（{rejectedCount}件）を見る</span>
              <span className="text-accentText text-base">›</span>
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
