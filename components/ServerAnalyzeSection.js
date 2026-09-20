"use client";

import { useEffect, useMemo, useState } from "react";
import { uploadMp3Files, runImport, fetchExistingRecords, compareWithExisting } from "../lib/importData";
import { analyzeMp3Files } from "../lib/analyzerClient";
import RegisteredEditList from "./RegisteredEditList";

const cardClass = "bg-white border-[3px] border-cardBorder rounded-2xl p-4";
const inputClass =
  "w-full px-3 py-2 rounded-xl border-[3px] border-cardBorder bg-white text-sm text-ink outline-none focus:border-accent";
const pickButtonClass =
  "inline-block cursor-pointer text-[11px] font-bold rounded-full border-2 border-cardBorder bg-page px-3.5 py-1.5 text-[#3F6C74] hover:border-accent";

// サーバーの入口（server/analyzer_app.py）が受け付ける名前と同じ決まり
const VALID_MP3_NAME = /^[A-Za-z0-9._-]{1,100}\.mp3$/;

const MIN_CONF_OPTIONS = [
  { value: "0.25", label: "0.25（標準・BirdNET の初期値／最近の記録と同じ）" },
  { value: "0.1", label: "0.1（低い鳥も拾う）" },
  { value: "0.01", label: "0.01（ほぼ全部）" },
];

const STAGE_LABEL = {
  mp3: "MP3を保存中",
  analyze: "サーバーで解析中",
  records: "記録を登録中",
};

// 🔥 「サーバーで解析」（管理者だけ）。MP3 だけ選ぶと、サーバー（BirdNET）が解析して、結果を返す。
//    流れ：MP3を保存 → 解析 → 結果と既存の記録との比較を確認 → 「記録を登録」
//    location：{ name, latitude, longitude, valid }（上の「場所」で指定したもの）
export default function ServerAnalyzeSection({ location, onRegistered }) {
  const [mp3Files, setMp3Files] = useState([]);
  const [inputKey, setInputKey] = useState(0);
  const [minConf, setMinConf] = useState("0.25");
  const [useFilter, setUseFilter] = useState(true); // 場所＋時期で、鳥を絞り込む（標準：オン）
  const [stereoBest, setStereoBest] = useState(true); // ステレオは、左右も別々に解析して、強い方を採る（標準：オン）

  const [phase, setPhase] = useState("idle"); // idle | working | analyzed | registering
  const [progress, setProgress] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [error, setError] = useState(null);
  const [registerResult, setRegisterResult] = useState(null);

  // 選び直したり、設定・場所の座標を変えたら、前の解析結果は使えない（もう一度、解析する）
  useEffect(() => {
    setAnalysis(null);
    setError(null);
  }, [mp3Files, minConf, useFilter, stereoBest, location.latitude, location.longitude]);

  const invalidNames = useMemo(() => mp3Files.map((f) => f.name).filter((n) => !VALID_MP3_NAME.test(n)), [mp3Files]);
  const canAnalyze = mp3Files.length > 0 && invalidNames.length === 0 && !!location.name.trim() && location.valid && phase === "idle";

  // 解析結果 → 登録する記録
  const { records, errorFiles, speciesCount } = useMemo(() => {
    if (!analysis) return { records: [], errorFiles: [], speciesCount: 0 };
    const recs = [];
    const errs = [];
    for (const [name, res] of Object.entries(analysis.results)) {
      if (res.error) {
        errs.push(name);
        continue;
      }
      for (const r of res.rows) recs.push({ wav_filename: name, ...r });
    }
    return { records: recs, errorFiles: errs, speciesCount: new Set(recs.map((r) => r.scientific_name)).size };
  }, [analysis]);

  async function handleAnalyze() {
    setPhase("working");
    setError(null);
    setAnalysis(null);
    setRegisterResult(null);
    try {
      const failed = await uploadMp3Files(mp3Files, setProgress);
      if (failed.length > 0) {
        throw new Error(`MP3 の保存に失敗しました：${failed.map((f) => `${f.name}（${f.message}）`).join("、")}`);
      }
      const names = mp3Files.map((f) => f.name);
      const a = await analyzeMp3Files({
        names,
        minConf: Number(minConf),
        location: useFilter ? { lat: location.latitude, lon: location.longitude } : null,
        useWeek: useFilter,
        stereo: stereoBest ? "best" : "mix",
        onProgress: setProgress,
      });
      const existing = await fetchExistingRecords(names);
      setAnalysis({ ...a, compare: compareWithExisting(a.results, existing), names });
    } catch (err) {
      console.error(err);
      setError(err?.message ?? String(err));
    } finally {
      setPhase("idle");
      setProgress(null);
    }
  }

  async function handleRegister() {
    setPhase("registering");
    setError(null);
    try {
      const res = await runImport({
        mp3Files: [], // MP3 は、解析の前に保存済み
        records,
        location: { name: location.name.trim(), latitude: location.latitude, longitude: location.longitude },
        onProgress: setProgress,
        extraColumns: {
          model_name: analysis.meta.model_name,
          model_version: analysis.meta.model_version,
          analyzed_at: analysis.meta.analyzed_at,
          analysis_params: analysis.meta.params,
        },
      });
      // 登録した録音の一覧（登録後に、そこから編集できるようにする）。記録が無かった録音は、場所が分からず、公開できないので入れない
      const files = analysis.names
        .map((name) => ({ name, rows: analysis.results[name]?.rows ?? [] }))
        .filter((f) => f.rows.length > 0);
      setRegisterResult(res.ok ? { ...res, files } : res);
      if (res.ok) {
        setMp3Files([]);
        setInputKey((k) => k + 1);
        onRegistered?.();
      }
    } catch (err) {
      console.error(err);
      setRegisterResult({ ok: false, unexpected: err?.message ?? String(err) });
    } finally {
      setPhase("idle");
      setProgress(null);
    }
  }

  const busy = phase === "working" || phase === "registering";

  return (
    <>
      <div className={cardClass}>
        <div className="text-xs font-bold text-ink mb-1">🖥 サーバーで解析</div>
        <p className="text-[11px] text-inkMuted leading-relaxed mb-3">
          MP3 だけ選ぶと、サーバー（BirdNET）が解析します。CSV は要りません。先に、上の「場所」を指定してください。
        </p>
        <label className={pickButtonClass}>
          MP3を選ぶ
          <input
            key={inputKey}
            type="file"
            multiple
            accept=".mp3,audio/mpeg"
            className="hidden"
            disabled={busy}
            onChange={(e) => {
              setMp3Files([...e.target.files]);
              setRegisterResult(null);
            }}
          />
        </label>
        {mp3Files.length > 0 && (
          <div className="mt-2 text-[11px] text-inkMuted leading-relaxed break-all">
            {mp3Files.length}個：{mp3Files.slice(0, 4).map((f) => f.name).join("、")}
            {mp3Files.length > 4 && ` ほか${mp3Files.length - 4}個`}
          </div>
        )}
        {invalidNames.length > 0 && (
          <p className="mt-2 text-[11px] text-red-500 leading-relaxed">
            使えない名前があります（英数字・「.」「_」「-」だけ、拡張子は小文字の .mp3）：{invalidNames.join("、")}
          </p>
        )}

        <div className="mt-4 text-[11px] font-bold text-ink">信頼度の下限</div>
        <select value={minConf} onChange={(e) => setMinConf(e.target.value)} disabled={busy} className={`${inputClass} mt-1`}>
          {MIN_CONF_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>

        <label className="mt-3 flex items-start gap-2 text-[11px] text-ink leading-relaxed">
          <input type="checkbox" checked={useFilter} onChange={(e) => setUseFilter(e.target.checked)} disabled={busy} className="mt-0.5" />
          <span>
            <b>場所と時期で、鳥を絞り込む</b>（標準：オン）
            <br />
            <span className="text-inkMuted">
              上で指定した場所の緯度経度と、録音の日付（ファイル名の先頭 YYMMDD）を使って、その場所・その時期にいない鳥を除きます。日付が読めないファイルは、場所だけで絞り込みます。
            </span>
          </span>
        </label>

        <label className="mt-3 flex items-start gap-2 text-[11px] text-ink leading-relaxed">
          <input type="checkbox" checked={stereoBest} onChange={(e) => setStereoBest(e.target.checked)} disabled={busy} className="mt-0.5" />
          <span>
            <b>ステレオは、左右も別々に解析して、強い方を採る</b>（標準：オン）
            <br />
            <span className="text-inkMuted">
              左右のマイクが離れていると、混ぜたときに、鳥の声が弱くなることがあります。Mac の BirdNET の画面（左右を混ぜた音だけ）と同じにしたいときは、オフにします。モノラルの録音には、関係ありません。
            </span>
          </span>
        </label>

        <button
          onClick={handleAnalyze}
          disabled={!canAnalyze}
          className="mt-4 w-full rounded-xl bg-[#3F6C74] text-white text-sm font-bold py-3 disabled:opacity-40"
        >
          {phase === "working" ? "解析中…" : "MP3を保存して解析する"}
        </button>
        {phase === "working" && progress && (
          <p className="mt-2 text-center text-[11px] text-inkMuted leading-relaxed">
            {STAGE_LABEL[progress.stage]}：{progress.done} / {progress.total}
            {progress.stage === "analyze" && "（初回は、サーバーの起動に1分ほどかかります）"}
          </p>
        )}
        {!busy && mp3Files.length > 0 && !(location.name.trim() && location.valid) && (
          <p className="mt-2 text-center text-[11px] text-red-500">上の「場所」の名前と緯度経度を指定してください。</p>
        )}
        {error && <p className="mt-2 text-[11px] text-red-500 leading-relaxed break-all">{error}</p>}
      </div>

      {analysis && (
        <div className={cardClass}>
          <div className="text-xs font-bold text-ink mb-2">解析の結果（まだ登録していません）</div>
          <p className="text-[11px] text-inkMuted leading-relaxed">
            {analysis.meta.model_name} {analysis.meta.model_version}・下限 {analysis.meta.params.min_conf}・
            {analysis.meta.params.location_filter
              ? `場所${analysis.meta.params.use_week ? "＋時期" : ""}で絞り込み`
              : "絞り込みなし"}
            ・{analysis.meta.params.stereo === "best" ? "ステレオは左右も別々に" : "左右を混ぜた音だけ"}
            ・サーバーの処理 {Math.round(analysis.elapsedSec)}秒
          </p>
          <p className="mt-1 text-[11px] text-ink font-bold">
            {analysis.names.length}本を解析：記録 {records.length}件（鳥 {speciesCount}種）
          </p>

          <ul className="mt-2 flex flex-col gap-2">
            {analysis.names.map((name) => {
              const res = analysis.results[name];
              const c = analysis.compare[name];
              if (!res || res.error) {
                return (
                  <li key={name} className="text-[11px] text-red-500 break-all">
                    {name}：{res?.error ?? "結果がありません"}
                  </li>
                );
              }
              const best = new Map();
              for (const r of res.rows) best.set(r.common_name, Math.max(best.get(r.common_name) ?? 0, r.confidence));
              const top = [...best.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
              return (
                <li key={name} className="text-[11px] text-inkMuted leading-relaxed border-t border-cardBorder pt-2 first:border-0 first:pt-0">
                  <div className="text-ink font-bold break-all">{name}</div>
                  <div>
                    {res.rows.length === 0
                      ? "検出なし（MP3 は保存済み）"
                      : `記録 ${res.rows.length}件・${top.map(([n, v]) => `${n} ${Math.round(v * 100)}%`).join("、")}`}
                    {res.week != null && `（週 ${res.week}）`}
                  </div>
                  {res.stereo && (
                    <div>
                      ステレオ（左右も別々に解析）：混ぜた音だけの場合より、増えた・高くなった記録 {res.stereo.gained_vs_mix}件
                    </div>
                  )}
                  <div>
                    {c && c.existingTotal > 0
                      ? `既存 ${c.existingTotal}件：同じ ${c.same}・値が変わる ${c.changed}・新しく増える ${c.new}${
                          c.existingOnly ? `・今回の結果に無い ${c.existingOnly}（消さずに残ります）` : ""
                        }`
                      : "新しいファイル（既存の記録なし）"}
                  </div>
                </li>
              );
            })}
          </ul>

          {analysis.warnings.length > 0 && (
            <ul className="mt-2 text-[11px] text-red-500 leading-relaxed">
              {analysis.warnings.map((w) => (
                <li key={w}>⚠ {w}</li>
              ))}
            </ul>
          )}

          <button
            onClick={handleRegister}
            disabled={busy || records.length === 0 || errorFiles.length > 0}
            className="mt-4 w-full rounded-xl bg-[#3F6C74] text-white text-sm font-bold py-3 disabled:opacity-40"
          >
            {phase === "registering" ? "登録中…" : `🚀 記録を登録する（${records.length}件）`}
          </button>
          {phase === "registering" && progress && (
            <p className="mt-2 text-center text-[11px] text-inkMuted">
              {STAGE_LABEL[progress.stage]}：{progress.done} / {progress.total}
            </p>
          )}
          {errorFiles.length > 0 && (
            <p className="mt-2 text-center text-[11px] text-red-500">解析に失敗したファイルがあります。もう一度、解析してください。</p>
          )}
          {errorFiles.length === 0 && records.length === 0 && (
            <p className="mt-2 text-center text-[11px] text-inkMuted">登録する記録がありません（MP3 は保存済みです）。</p>
          )}
          <p className="mt-2 text-[10px] text-inkMuted leading-relaxed">
            登録すると、同じ記録は上書きされます（消す機能はありません）。各記録に、モデル名・バージョン・解析日時・設定が残ります。
          </p>
        </div>
      )}

      {registerResult && (
        <div className={`${cardClass} ${registerResult.ok ? "" : "border-red-300"}`}>
          {registerResult.ok ? (
            <>
              <div className="text-xs font-bold text-[#3F6C74]">✓ 登録が完了しました</div>
              <p className="mt-1 text-[11px] text-inkMuted leading-relaxed">
                記録 {registerResult.recordsSent}件を送り、合計 {registerResult.before}件 → {registerResult.after}件（新しく増えたのは{" "}
                {registerResult.after - registerResult.before}件、残り{" "}
                {Math.max(0, registerResult.recordsSent - (registerResult.after - registerResult.before))}件は、同じ記録の上書きです）。
              </p>
            </>
          ) : (
            <>
              <div className="text-xs font-bold text-red-500">登録できませんでした</div>
              <div className="mt-1 text-[11px] text-inkMuted leading-relaxed break-all">
                {registerResult.recordError && (
                  <p>
                    記録の登録でエラー（{registerResult.recordError}）。ここまでに送った分：{registerResult.recordsSent}件。
                  </p>
                )}
                {registerResult.unexpected && <p>予期しないエラー：{registerResult.unexpected}</p>}
                <p className="mt-1">解析の結果は、そのまま残っています。もう一度「記録を登録する」を押しても、上書きなので安全です。</p>
              </div>
            </>
          )}
        </div>
      )}

      {registerResult?.ok && <RegisteredEditList files={registerResult.files} />}
    </>
  );
}
