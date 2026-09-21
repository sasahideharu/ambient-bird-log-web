"use client";

import { useEffect, useState } from "react";
import { loadPlaces } from "../lib/geo";
import { saveSettings } from "../lib/recorderSettings";

const inputClass = "w-full px-3 py-2 rounded-xl border-[3px] border-cardBorder bg-white text-sm text-ink outline-none focus:border-accent";
const smallBtn = "rounded-full border-2 border-cardBorder bg-page px-3 py-1.5 text-[11px] font-bold text-[#3F6C74] hover:border-accent disabled:opacity-40";

// 録音の設定（録音者名・デフォルトの場所）。変えると、すぐ、この端末に保存される。
//   デフォルトの場所は、位置情報（GPS）が取れなかったときに、録音の場所として使う
//   currentPosition：いま取れている現在地 { latitude, longitude, accuracyM } か null（「今の場所を使う」用）
export default function RecorderSettingsPanel({ settings, onChange, currentPosition }) {
  const [places, setPlaces] = useState([]);
  const [placesLoading, setPlacesLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    loadPlaces()
      .then((p) => alive && setPlaces(p))
      .finally(() => alive && setPlacesLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  function update(next) {
    saveSettings(next);
    onChange(next);
  }

  const dl = settings.defaultLocation;
  const setLocation = (patch) => update({ ...settings, defaultLocation: { name: "", latitude: null, longitude: null, ...dl, ...patch } });
  const numOrNull = (v) => (v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

  return (
    <div className="flex flex-col gap-3">
      <div>
        <div className="text-[11px] font-bold text-ink mb-1">録音者の名前</div>
        <input
          value={settings.recorderName}
          onChange={(e) => update({ ...settings, recorderName: e.target.value })}
          placeholder="例：ささ"
          maxLength={40}
          className={inputClass}
        />
        <p className="mt-1 text-[10px] text-inkMuted leading-relaxed">録音の記録に「誰が」として残ります（管理者だけに見えます）。</p>
      </div>

      <div>
        <div className="text-[11px] font-bold text-ink mb-1">デフォルトの場所</div>
        <p className="mb-2 text-[10px] text-inkMuted leading-relaxed">位置情報（GPS）が取れなかったときに、この場所を、録音の場所として使います。</p>

        <select
          value=""
          onChange={(e) => {
            const p = places.find((x) => x.name === e.target.value);
            if (p) update({ ...settings, defaultLocation: { name: p.name, latitude: p.latitude, longitude: p.longitude } });
          }}
          className={`${inputClass} mb-2`}
          disabled={placesLoading || places.length === 0}
        >
          <option value="">{placesLoading ? "これまでの場所を読み込み中…" : places.length === 0 ? "これまでの場所（取得できませんでした）" : "これまでの場所から選ぶ…"}</option>
          {places.map((p) => (
            <option key={p.name} value={p.name}>
              {p.name}
            </option>
          ))}
        </select>

        <input value={dl?.name ?? ""} onChange={(e) => setLocation({ name: e.target.value })} placeholder="場所の名前（例：早戸川林道 / 相模原市）" className={`${inputClass} mb-2`} />
        <div className="grid grid-cols-2 gap-2">
          <input
            type="number"
            step="any"
            value={dl?.latitude ?? ""}
            onChange={(e) => setLocation({ latitude: numOrNull(e.target.value) })}
            placeholder="緯度（例：35.5）"
            className={inputClass}
          />
          <input
            type="number"
            step="any"
            value={dl?.longitude ?? ""}
            onChange={(e) => setLocation({ longitude: numOrNull(e.target.value) })}
            placeholder="経度（例：139.3）"
            className={inputClass}
          />
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            className={smallBtn}
            disabled={!currentPosition}
            onClick={() => currentPosition && setLocation({ latitude: Number(currentPosition.latitude.toFixed(5)), longitude: Number(currentPosition.longitude.toFixed(5)) })}
          >
            今の場所の緯度経度を入れる
          </button>
          {dl && (
            <button className={smallBtn} onClick={() => update({ ...settings, defaultLocation: null })}>
              デフォルトの場所を消す
            </button>
          )}
        </div>
        {dl && (dl.latitude === null || dl.longitude === null) && <p className="mt-1 text-[10px] text-red-500">緯度と経度が、両方入るまで、使われません。</p>}
      </div>
    </div>
  );
}
