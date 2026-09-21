"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { loadPlaces } from "../lib/geo";
import { searchPlaces } from "../lib/geocode";
import { writeMeta } from "../lib/recordingStore";
import { isoWithOffset } from "../lib/recorder";

// 🔥 Leaflet はブラウザ専用のため、SSR を無効化して読み込む（データ登録の画面と同じ）
const LocationPicker = dynamic(() => import("./LocationPicker"), {
  ssr: false,
  loading: () => <div className="flex h-[240px] items-center justify-center rounded-xl border-[3px] border-cardBorder bg-white text-xs text-inkMuted">地図を読み込み中...</div>,
});

const inputClass = "w-full px-3 py-2 rounded-xl border-[3px] border-cardBorder bg-white text-sm text-ink outline-none focus:border-accent";
const smallBtn = "rounded-full border-2 border-cardBorder bg-page px-3 py-1.5 text-[11px] font-bold text-[#3F6C74] hover:border-accent disabled:opacity-40";

const numOrNull = (v) => (v === "" || v == null || !Number.isFinite(Number(v)) ? null : Number(v));
const validLat = (v) => v != null && v >= -90 && v <= 90;
const validLon = (v) => v != null && v >= -180 && v <= 180;

// 🔥 録音の「場所」と「メモ」を、あとから変える（端末の中の記録だけを書き換える。電波が無くても使える。地図・検索は電波が要る）
//    ・場所の選び方：これまでの場所から選ぶ／名前で探す／地図をタップ／緯度経度を入れる
//    ・最初に変えるときに、録音したときの場所（GPS など）を locationOriginal に残す。「録音したときの場所に戻す」で、戻せる
//    meta：録音の記録／onSaved()：保存したあと／onCancel()：やめる
export default function RecordingPlaceEditor({ meta, onSaved, onCancel }) {
  const original = meta.locationOriginal ?? meta.location ?? null;
  const cur = meta.location ?? {};
  const [name, setName] = useState(cur.name ?? "");
  const [lat, setLat] = useState(cur.latitude != null ? String(cur.latitude) : "");
  const [lon, setLon] = useState(cur.longitude != null ? String(cur.longitude) : "");
  const [note, setNote] = useState(meta.note ?? "");
  const [places, setPlaces] = useState([]);
  const [placesLoading, setPlacesLoading] = useState(true);
  const [searchText, setSearchText] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState(null);
  const [searchError, setSearchError] = useState(null);
  const [focus, setFocus] = useState(null);
  const [showMap, setShowMap] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    loadPlaces()
      .then((p) => alive && setPlaces(p))
      .finally(() => alive && setPlacesLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  const latNum = numOrNull(lat);
  const lonNum = numOrNull(lon);
  const coordsValid = validLat(latNum) && validLon(lonNum);

  function pickPlace(p) {
    setName(p.name);
    setLat(String(p.latitude));
    setLon(String(p.longitude));
    setFocus({ lat: p.latitude, lon: p.longitude, nonce: Date.now() });
  }

  function handleMapPick(latitude, longitude) {
    setLat(latitude.toFixed(6));
    setLon(longitude.toFixed(6));
  }

  async function handleSearch() {
    if (!searchText.trim() || searching) return;
    setSearching(true);
    setSearchError(null);
    try {
      setSearchResults(await searchPlaces(searchText));
    } catch (err) {
      console.error(err);
      setSearchResults(null);
      setSearchError("検索できませんでした。通信を確認するか、地図をタップして場所を指定してください。");
    } finally {
      setSearching(false);
    }
  }

  function pickResult(p) {
    handleMapPick(p.latitude, p.longitude);
    setFocus({ lat: p.latitude, lon: p.longitude, nonce: Date.now() });
    if (!name.trim()) setName(p.suggestedName);
    setSearchResults(null);
    setShowMap(true);
  }

  function revertToOriginal() {
    setName(original?.name ?? "");
    setLat(original?.latitude != null ? String(original.latitude) : "");
    setLon(original?.longitude != null ? String(original.longitude) : "");
  }

  async function save() {
    if (saving) return;
    setError(null);
    const hasCoords = lat.trim() !== "" || lon.trim() !== "";
    if (hasCoords && !coordsValid) {
      setError("緯度は -90〜90、経度は -180〜180 の数字で、両方入れてください。");
      return;
    }
    setSaving(true);
    try {
      const next = { ...meta };
      delete next._files; // 一覧のために足した、表示用の値（記録には残さない）
      if (!next.locationOriginal) next.locationOriginal = meta.location ?? null;
      const backToOriginal = coordsValid && next.locationOriginal && latNum === next.locationOriginal.latitude && lonNum === next.locationOriginal.longitude && name.trim() === (next.locationOriginal.name ?? "");
      next.location = coordsValid
        ? backToOriginal
          ? { ...next.locationOriginal }
          : { latitude: latNum, longitude: lonNum, accuracyM: null, source: "manual", name: name.trim() || null }
        : { latitude: null, longitude: null, accuracyM: null, source: "none", name: name.trim() || null };
      next.locationEditedAt = isoWithOffset(new Date());
      next.note = note.trim() || null;
      await writeMeta(next);
      onSaved?.(next);
    } catch (err) {
      console.error(err);
      setError(`保存できませんでした（${err?.message ?? err}）`);
      setSaving(false);
    }
  }

  return (
    <div className="mt-2 rounded-xl border-[3px] border-cardBorder bg-page p-3">
      <div className="text-xs font-bold text-ink">📍 場所とメモを変える</div>

      <div className="mt-2 text-[11px] font-bold text-ink">これまでの場所から選ぶ</div>
      <select
        value=""
        onChange={(e) => {
          const p = places.find((x) => x.name === e.target.value);
          if (p) pickPlace(p);
        }}
        className={`${inputClass} mt-1`}
        disabled={placesLoading || places.length === 0}
      >
        <option value="">{placesLoading ? "読み込み中…" : places.length === 0 ? "（取得できませんでした）" : "選ぶ…"}</option>
        {places.map((p) => (
          <option key={p.name} value={p.name}>
            {p.name}
          </option>
        ))}
      </select>

      <div className="mt-3 text-[11px] font-bold text-ink">名前で探す（電波が要ります）</div>
      <div className="mt-1 flex gap-2">
        <input
          type="search"
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          onKeyDown={(e) => {
            // 日本語の変換を確定する Enter では、検索しない
            if (e.key === "Enter" && !e.nativeEvent.isComposing) {
              e.preventDefault();
              handleSearch();
            }
          }}
          placeholder="例：西湖"
          className={inputClass}
        />
        <button onClick={handleSearch} disabled={searching || !searchText.trim()} className="shrink-0 rounded-xl bg-[#3F6C74] px-4 text-xs font-bold text-white disabled:opacity-40">
          {searching ? "検索中…" : "検索"}
        </button>
      </div>
      {searchError && <p className="mt-2 text-[11px] leading-relaxed text-red-500">{searchError}</p>}
      {searchResults && (
        <div className="mt-2 flex max-h-44 flex-col gap-1 overflow-y-auto">
          {searchResults.length === 0 && <p className="text-[11px] leading-relaxed text-inkMuted">見つかりませんでした。言葉を変えるか、地図をタップして指定してください。</p>}
          {searchResults.map((p, i) => (
            <button key={`${p.latitude},${p.longitude},${i}`} onClick={() => pickResult(p)} className="rounded-lg border-2 border-cardBorder bg-white px-3 py-2 text-left hover:border-accent">
              <div className="text-xs font-bold text-ink">{p.name}</div>
              {p.detail && <div className="mt-0.5 text-[10px] text-inkMuted">{p.detail}</div>}
            </button>
          ))}
        </div>
      )}

      <div className="mt-3 text-[11px] font-bold text-ink">場所の名前</div>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="例：早戸川林道 / 相模原市" maxLength={80} className={`${inputClass} mt-1`} />
      <div className="mt-2 grid grid-cols-2 gap-2">
        <input type="number" step="any" value={lat} onChange={(e) => setLat(e.target.value)} placeholder="緯度（例：35.5）" className={inputClass} />
        <input type="number" step="any" value={lon} onChange={(e) => setLon(e.target.value)} placeholder="経度（例：139.3）" className={inputClass} />
      </div>

      <div className="mt-2 flex flex-wrap gap-2">
        <button className={smallBtn} onClick={() => setShowMap((v) => !v)}>
          {showMap ? "🗺 地図を閉じる" : "🗺 地図で選ぶ（電波が要ります）"}
        </button>
        {original && (
          <button className={smallBtn} onClick={revertToOriginal}>
            録音したときの場所に戻す
          </button>
        )}
      </div>
      {showMap && (
        <div className="mt-2">
          <LocationPicker position={coordsValid ? [latNum, lonNum] : null} onPick={handleMapPick} focus={focus} points={places} />
          <p className="mt-1.5 text-[10px] leading-relaxed text-inkMuted">地図をタップするか、青いピンをドラッグして指定します（灰色の点は、これまでの場所）。</p>
        </div>
      )}
      {original && (
        <p className="mt-2 text-[10px] leading-relaxed text-inkMuted">
          録音したときの場所：{original.name || "名前なし"}
          {original.latitude != null ? `（${original.source === "gps" ? "GPS" : original.source === "default" ? "デフォルト" : "手入力"}・${original.latitude.toFixed(3)}, ${original.longitude.toFixed(3)}）` : "（場所なし）"}
        </p>
      )}

      <div className="mt-3 text-[11px] font-bold text-ink">メモ</div>
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="例：朝の林道・小雨" maxLength={200} className={`${inputClass} mt-1`} />

      {error && <p className="mt-2 text-[11px] leading-relaxed text-red-500">{error}</p>}
      <div className="mt-3 flex gap-2">
        <button onClick={save} disabled={saving} className="flex-1 rounded-xl bg-[#3F6C74] py-2 text-[12px] font-bold text-white disabled:opacity-40">
          {saving ? "保存中…" : "保存する"}
        </button>
        <button onClick={onCancel} disabled={saving} className="flex-1 rounded-xl border-2 border-cardBorder bg-white py-2 text-[12px] font-bold text-[#3F6C74]">
          やめる
        </button>
      </div>
    </div>
  );
}
