"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import {
  buildImportPreview,
  fetchLocationChoices,
  listStorageFileNames,
  runImport,
} from "../lib/importData";
import { searchPlaces } from "../lib/geocode";
import { resetSpeciesChoices } from "../lib/verifications";

// 🔥 Leafletはブラウザ専用（windowが必要）のためSSRを無効化して読み込む（管理画面の地図と同じ）
const LocationPicker = dynamic(() => import("./LocationPicker"), {
  ssr: false,
  loading: () => (
    <div className="rounded-xl border-[3px] border-cardBorder bg-white h-[240px] flex items-center justify-center text-xs text-inkMuted">
      地図を読み込み中...
    </div>
  ),
});

const cardClass = "bg-white border-[3px] border-cardBorder rounded-2xl p-4";
const inputClass =
  "w-full px-3 py-2 rounded-xl border-[3px] border-cardBorder bg-white text-sm text-ink outline-none focus:border-accent";
const pickButtonClass =
  "inline-block cursor-pointer text-[11px] font-bold rounded-full border-2 border-cardBorder bg-page px-3.5 py-1.5 text-[#3F6C74] hover:border-accent";

function FilePicker({ label, accept, files, onPick, inputKey }) {
  return (
    <div>
      <label className={pickButtonClass}>
        {label}
        <input
          key={inputKey}
          type="file"
          multiple
          accept={accept}
          className="hidden"
          onChange={(e) => onPick([...e.target.files])}
        />
      </label>
      {files.length > 0 && (
        <div className="mt-2 text-[11px] text-inkMuted leading-relaxed break-all">
          {files.length}個：{files.slice(0, 4).map((f) => f.name).join("、")}
          {files.length > 4 && ` ほか${files.length - 4}個`}
        </div>
      )}
    </div>
  );
}

const STAGE_LABEL = { mp3: "MP3を保存中", records: "記録を登録中" };

// 🔥 「解析データ＆音声」の登録（管理者だけ）。BirdNET の CSV と、変換済みの MP3 を選んで登録する
export default function ImportDataPanel() {
  const [locations, setLocations] = useState([]);
  const [storageNames, setStorageNames] = useState(null); // 保存場所にある MP3 の名前（null＝読み込み前）
  const [loadError, setLoadError] = useState(null);

  const [selectedLoc, setSelectedLoc] = useState(""); // ""＝新規追加
  const [locName, setLocName] = useState("");
  // 新規追加のときは、空から始める（地図で指定するか、直接入力するまで、登録できない）
  const [lat, setLat] = useState("");
  const [lon, setLon] = useState("");

  // 新規追加のときの、場所の検索（OpenStreetMap）
  const [searchText, setSearchText] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState(null); // null＝まだ検索していない
  const [searchError, setSearchError] = useState(null);
  const [focus, setFocus] = useState(null); // 検索結果を選んだとき、地図を動かす先

  const [csvFiles, setCsvFiles] = useState([]);
  const [mp3Files, setMp3Files] = useState([]);
  const [inputKey, setInputKey] = useState(0); // 登録後に、選んだファイルの表示を空に戻す
  const [preview, setPreview] = useState(null);

  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(null);
  const [result, setResult] = useState(null);

  async function reloadChoices() {
    try {
      const [locs, names] = await Promise.all([fetchLocationChoices(), listStorageFileNames()]);
      setLocations(locs);
      setStorageNames(names);
      setLoadError(null);
      return locs;
    } catch (err) {
      console.error(err);
      setLoadError("場所や保存済みの音声の一覧を取得できませんでした。通信やログインの状態を確認してください。");
      return null;
    }
  }

  useEffect(() => {
    reloadChoices();
  }, []);

  // 選んだファイルから、登録前の確認（何件・どの MP3 と結びつくか）を作る。何も書き込まない
  useEffect(() => {
    let alive = true;
    async function build() {
      if (storageNames === null || csvFiles.length === 0) {
        setPreview(null);
        return;
      }
      const csvTexts = await Promise.all(csvFiles.map(async (f) => ({ name: f.name, text: await f.text() })));
      if (!alive) return;
      setPreview(
        buildImportPreview({ csvTexts, selectedMp3Names: mp3Files.map((f) => f.name), storageNames })
      );
    }
    build();
    return () => {
      alive = false;
    };
  }, [csvFiles, mp3Files, storageNames]);

  function handleSelectLocation(name) {
    setSelectedLoc(name);
    setSearchResults(null);
    setSearchError(null);
    if (name === "") {
      setLocName("");
      setLat("");
      setLon("");
      return;
    }
    const loc = locations.find((l) => l.name === name);
    if (loc) {
      setLocName(loc.name);
      setLat(String(loc.latitude));
      setLon(String(loc.longitude));
    }
  }

  // 地図をタップ・ピンをドラッグ → 緯度経度に入れる
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

  // 検索結果を選ぶ → 地図をその場所に動かし、ピンを立てて、緯度経度に入れる。名前の欄が空なら、名前の候補も入れる
  function handlePickResult(place) {
    handleMapPick(place.latitude, place.longitude);
    setFocus({ lat: place.latitude, lon: place.longitude, nonce: Date.now() });
    if (!locName.trim()) setLocName(place.suggestedName);
    setSearchResults(null);
  }

  const latNum = Number(lat);
  const lonNum = Number(lon);
  const coordsValid =
    lat.trim() !== "" &&
    lon.trim() !== "" &&
    Number.isFinite(latNum) &&
    Number.isFinite(lonNum) &&
    Math.abs(latNum) <= 90 &&
    Math.abs(lonNum) <= 180;
  const isNewLocation = selectedLoc === "";
  const unsafeMp3 = useMemo(
    () => mp3Files.map((f) => f.name).filter((n) => !/^[A-Za-z0-9._-]+$/.test(n)),
    [mp3Files]
  );
  const hasSomething = csvFiles.length > 0 || mp3Files.length > 0;
  const blocked =
    running ||
    !locName.trim() ||
    !coordsValid ||
    !hasSomething ||
    storageNames === null ||
    unsafeMp3.length > 0 ||
    (csvFiles.length > 0 && (!preview || preview.hasCsvError || preview.unmatchedKeys.length > 0));

  const recordCount = preview?.records.length ?? 0;

  async function handleRun() {
    setRunning(true);
    setResult(null);
    setProgress(null);
    try {
      const res = await runImport({
        mp3Files,
        records: preview?.records ?? [],
        location: { name: locName.trim(), latitude: latNum, longitude: lonNum },
        onProgress: setProgress,
      });
      setResult(res);
      if (res.ok) {
        setCsvFiles([]);
        setMp3Files([]);
        setInputKey((k) => k + 1);
        resetSpeciesChoices();
        // 新しい場所を登録したときは、次からは「既存の場所」として選ばれた状態にする（続けて登録しやすい）
        const registeredName = locName.trim();
        const locs = await reloadChoices();
        if (locs?.some((l) => l.name === registeredName)) {
          setSelectedLoc(registeredName);
          setSearchResults(null);
        }
      }
    } catch (err) {
      console.error(err);
      setResult({ ok: false, unexpected: err?.message ?? String(err) });
    } finally {
      setRunning(false);
      setProgress(null);
    }
  }

  return (
    <div className="px-4 pb-6 flex flex-col gap-3">
      {loadError && <p className="text-center text-xs text-red-500 px-2">{loadError}</p>}

      <div className={cardClass}>
        <div className="text-xs font-bold text-ink mb-2">📍 場所</div>
        <select
          value={selectedLoc}
          onChange={(e) => handleSelectLocation(e.target.value)}
          className={inputClass}
        >
          <option value="">（新規追加）</option>
          {locations.map((l) => (
            <option key={l.name} value={l.name}>
              {l.name}
            </option>
          ))}
        </select>

        {isNewLocation && (
          <div className="mt-3">
            <div className="flex gap-2">
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
                placeholder="場所を検索（例：西湖）"
                className={inputClass}
              />
              <button
                onClick={handleSearch}
                disabled={searching || !searchText.trim()}
                className="shrink-0 rounded-xl bg-[#3F6C74] text-white text-xs font-bold px-4 disabled:opacity-40"
              >
                {searching ? "検索中…" : "検索"}
              </button>
            </div>
            {searchError && <p className="mt-2 text-[11px] text-red-500 leading-relaxed">{searchError}</p>}
            {searchResults && (
              <div className="mt-2 flex flex-col gap-1 max-h-44 overflow-y-auto">
                {searchResults.length === 0 && (
                  <p className="text-[11px] text-inkMuted leading-relaxed">
                    見つかりませんでした。言葉を変えて検索するか、地図をタップして場所を指定してください。
                  </p>
                )}
                {searchResults.map((p, i) => (
                  <button
                    key={`${p.latitude},${p.longitude},${i}`}
                    onClick={() => handlePickResult(p)}
                    className="text-left rounded-lg border-2 border-cardBorder bg-page px-3 py-2 hover:border-accent"
                  >
                    <div className="text-xs font-bold text-ink">{p.name}</div>
                    {p.detail && <div className="text-[10px] text-inkMuted mt-0.5">{p.detail}</div>}
                  </button>
                ))}
              </div>
            )}
            <div className="mt-2">
              <LocationPicker
                position={coordsValid ? [latNum, lonNum] : null}
                onPick={handleMapPick}
                focus={focus}
                points={locations}
              />
            </div>
            <p className="mt-1.5 text-[10px] text-inkMuted leading-relaxed">
              地図をタップするか、青いピンをドラッグして、場所を指定します（灰色の点は、登録済みの場所）。
            </p>
          </div>
        )}

        <input
          type="text"
          value={locName}
          onChange={(e) => setLocName(e.target.value)}
          placeholder="場所の名前"
          className={`${inputClass} mt-3`}
        />
        <div className="grid grid-cols-2 gap-2 mt-2">
          <label className="text-[10px] font-bold text-inkMuted">
            🌐 緯度
            <input type="number" step="any" value={lat} onChange={(e) => setLat(e.target.value)} className={`${inputClass} mt-1`} />
          </label>
          <label className="text-[10px] font-bold text-inkMuted">
            🌐 経度
            <input type="number" step="any" value={lon} onChange={(e) => setLon(e.target.value)} className={`${inputClass} mt-1`} />
          </label>
        </div>
        {!coordsValid && (
          <p className="mt-2 text-[11px] text-red-500 leading-relaxed">
            {isNewLocation && lat.trim() === "" && lon.trim() === ""
              ? "地図で場所を指定するか、緯度・経度を入力してください。"
              : "緯度（-90〜90）と経度（-180〜180）を入れてください。"}
          </p>
        )}
      </div>

      <div className={cardClass}>
        <div className="text-xs font-bold text-ink mb-2">📄 BirdNET の CSV（複数OK）</div>
        <FilePicker label="CSVを選ぶ" accept=".csv,text/csv" files={csvFiles} onPick={setCsvFiles} inputKey={`c${inputKey}`} />
        <div className="text-xs font-bold text-ink mt-4 mb-2">🎵 録音データ MP3（複数OK）</div>
        <FilePicker label="MP3を選ぶ" accept=".mp3,audio/mpeg" files={mp3Files} onPick={setMp3Files} inputKey={`m${inputKey}`} />
        {unsafeMp3.length > 0 && (
          <p className="mt-2 text-[11px] text-red-500 leading-relaxed">
            保存できない文字が名前に含まれています（英数字・「.」「_」「-」だけ使えます）：{unsafeMp3.join("、")}
          </p>
        )}
      </div>

      {preview && (
        <div className={cardClass}>
          <div className="text-xs font-bold text-ink mb-2">登録前の確認</div>
          <ul className="text-[11px] text-inkMuted leading-relaxed flex flex-col gap-1">
            {preview.perFile.map((f) => (
              <li key={f.name} className={f.error ? "text-red-500" : ""}>
                {f.name}：{f.error ?? `${f.rows}行・鳥${f.species}種${f.skipped ? `（読めない行 ${f.skipped}行は除きます）` : ""}`}
              </li>
            ))}
          </ul>
          {preview.duplicates > 0 && (
            <p className="mt-2 text-[11px] text-inkMuted">同じ記録が重なっていた分（{preview.duplicates}件）は、1つにまとめます。</p>
          )}
          {preview.unmatchedKeys.length > 0 && (
            <p className="mt-2 text-[11px] text-red-500 leading-relaxed">
              ⚠ 対応する MP3 が見つからないファイル：{preview.unmatchedKeys.join("、")}
              。再生できない記録が増えないよう、この状態では登録できません。対応する MP3 も選んでください（この画面では、登録した記録を消せません）。
            </p>
          )}
          {preview.ambiguousKeys.length > 0 && (
            <p className="mt-2 text-[11px] text-red-500 leading-relaxed">
              ⚠ 同じ番号の MP3 が複数あります：{preview.ambiguousKeys.join("、")}（最初に見つかったものと結びつけます）
            </p>
          )}
        </div>
      )}

      <div className={cardClass}>
        <p className="text-[11px] text-inkMuted leading-relaxed">
          {hasSomething
            ? `MP3 ${mp3Files.length}件を保存し、記録 ${recordCount}件${preview ? `（鳥${preview.speciesCount}種）` : ""}を「${locName.trim() || "（場所未入力）"}」として登録します。同じ名前の MP3・同じ記録は、上書きされます。`
            : "CSV や MP3 を選ぶと、ここに登録する内容が出ます。"}
        </p>
        <button
          onClick={handleRun}
          disabled={blocked}
          className="mt-3 w-full rounded-xl bg-[#3F6C74] text-white text-sm font-bold py-3 disabled:opacity-40"
        >
          {running ? "登録中…" : "🚀 一括登録する"}
        </button>
        {running && progress && (
          <p className="mt-2 text-center text-[11px] text-inkMuted">
            {STAGE_LABEL[progress.stage]}：{progress.done} / {progress.total}
          </p>
        )}
        {!running && !locName.trim() && hasSomething && (
          <p className="mt-2 text-center text-[11px] text-red-500">場所の名前を入力してください。</p>
        )}
      </div>

      {result && (
        <div className={`${cardClass} ${result.ok ? "" : "border-red-300"}`}>
          {result.ok ? (
            <>
              <div className="text-xs font-bold text-[#3F6C74]">✓ 登録が完了しました</div>
              <p className="mt-1 text-[11px] text-inkMuted leading-relaxed">
                MP3 {result.mp3Saved}件を保存。記録は {result.recordsSent}件を送り、合計 {result.before}件 → {result.after}件
                （新しく増えたのは {result.after - result.before}件、残り {Math.max(0, result.recordsSent - (result.after - result.before))}件は、同じ記録の上書きです）。
              </p>
            </>
          ) : (
            <>
              <div className="text-xs font-bold text-red-500">登録できませんでした</div>
              <div className="mt-1 text-[11px] text-inkMuted leading-relaxed break-all">
                {result.failedMp3?.length > 0 && (
                  <p>
                    MP3 の保存に失敗（{result.failedMp3.length}件）：
                    {result.failedMp3.map((f) => `${f.name}（${f.message}）`).join("、")}。記録は登録していません。
                  </p>
                )}
                {result.recordError && (
                  <p>記録の登録でエラー（{result.recordError}）。ここまでに送った分：{result.recordsSent}件。</p>
                )}
                {result.unexpected && <p>予期しないエラー：{result.unexpected}</p>}
                <p className="mt-1">同じ内容でもう一度登録しても、上書きなので安全です。</p>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
