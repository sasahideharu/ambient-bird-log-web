"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { uploadMp3Files, runImport, fetchExistingRecords, compareWithExisting } from "../lib/importData";
import { analyzeMp3Files } from "../lib/analyzerClient";
import { prepareWav, isWavName } from "../lib/wavPrepare";
import { uploadAnalysisWavs, deleteAnalysisWavs } from "../lib/analysisWav";
import { opinionRows, saveOpinions, judge } from "../lib/modelOpinions";
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
  wav: "解析用のWAVを保存中",
  analyze: "サーバーで解析中",
  cleanup: "解析用のWAVを消しています",
  records: "記録を登録中",
};

const mb = (bytes) => (bytes / 1048576).toFixed(1);
const PERCH_STRONG_LOGIT = 8; // Perch の点数（logit）：これ以上なら「強く言っている」（確かな検出は 9〜12・雑音は 4〜7 の目安）

// 1本の結果について、Perch の意見のまとめ：BirdNET の記録が Perch の上位にもいる数・Perch だけが強く言う鳥
function perchSummary(res) {
  const windows = res.perch?.windows;
  if (!windows || windows.length === 0) return null;
  let same = 0;
  for (const r of res.rows) if (judge(r.scientific_name, windows, r.start_sec, r.end_sec).status === "same") same++;
  const only = new Map(); // 名前 → 一番高い点数
  for (const w of windows) {
    const t = w.top[0];
    if (!t || t.logit < PERCH_STRONG_LOGIT) continue;
    if (res.rows.some((r) => r.scientific_name === t.sci && r.end_sec > w.t0 && r.start_sec < w.t1)) continue;
    const label = t.common ?? t.sci;
    only.set(label, Math.max(only.get(label) ?? 0, t.logit));
  }
  return { total: res.rows.length, same, only: [...only.entries()].sort((a, b) => b[1] - a[1]) };
}
const inputLabel = (kind) => (kind === "wav" ? "wav-48k-16bit" : "mp3"); // 解析した音の種類（記録の analysis_params に残す）

// 🔥 「サーバーで解析」（管理者だけ）。MP3 か WAV を選ぶと、サーバー（BirdNET）が解析して、結果を返す。
//    流れ：（WAV は、この画面の中で 48kHz・16bit に変換）→ 保存 → 解析 → 結果と既存の記録との比較を確認 → 「記録を登録」
//    ・MP3：解析の前に、保管場所に保存して、それを解析する（これまでどおり）
//    ・WAV：解析用の WAV（48kHz・16bit）を一時的に保存して解析し、解析のあとで消す。再生用の MP3 は、「記録を登録」のときに保存する
//    location：{ name, latitude, longitude, valid }（上の「場所」で指定したもの）
export default function ServerAnalyzeSection({ location, onRegistered }) {
  // 選んだファイルは、変換のあと、items になる：{ name（登録する MP3 の名前）, kind："mp3"｜"wav", mp3File, wavFile（WAV のときだけ）, info }
  const [items, setItems] = useState([]);
  const [convert, setConvert] = useState(null); // WAV の変換中：{ done, total }
  const [convertErrors, setConvertErrors] = useState([]); // 変換できなかったもの：[{ name, message }]
  const pickToken = useRef(0);
  const [inputKey, setInputKey] = useState(0);
  const [minConf, setMinConf] = useState("0.25");
  const [useFilter, setUseFilter] = useState(true); // 場所＋時期で、鳥を絞り込む（標準：オン）
  const [stereoBest, setStereoBest] = useState(true); // ステレオは、左右も別々に解析して、強い方を採る（標準：オン）
  const [usePerch, setUsePerch] = useState(true); // 別のモデル Perch も解析して、「別モデルの意見」を残す（標準：オン。場所＋時期の絞り込みが要る）

  const [phase, setPhase] = useState("idle"); // idle | working | analyzed | registering
  const [progress, setProgress] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [error, setError] = useState(null);
  const [registerResult, setRegisterResult] = useState(null);
  const [cleanupWarning, setCleanupWarning] = useState(null); // 解析用の WAV を消せなかったとき

  // 選び直したり、設定・場所の座標を変えたら、前の解析結果は使えない（もう一度、解析する）
  useEffect(() => {
    setAnalysis(null);
    setError(null);
  }, [items, minConf, useFilter, stereoBest, usePerch, location.latitude, location.longitude]);

  const invalidNames = useMemo(() => items.map((i) => i.name).filter((n) => !VALID_MP3_NAME.test(n)), [items]);
  const duplicateNames = useMemo(() => {
    const seen = new Set();
    const dup = new Set();
    for (const i of items) (seen.has(i.name) ? dup : seen).add(i.name);
    return [...dup];
  }, [items]);
  const hasWav = items.some((i) => i.kind === "wav");
  const canAnalyze =
    items.length > 0 &&
    invalidNames.length === 0 &&
    duplicateNames.length === 0 &&
    convertErrors.length === 0 &&
    !convert &&
    !!location.name.trim() &&
    location.valid &&
    phase === "idle";

  // ファイルを選んだ：WAV は、この画面の中で、解析用の WAV（48kHz・16bit）と、再生用の MP3 に変換する（1本ずつ）
  async function handlePick(fileList) {
    const token = ++pickToken.current;
    setRegisterResult(null);
    setCleanupWarning(null);
    setItems([]);
    setConvertErrors([]);
    const total = fileList.filter((f) => isWavName(f.name)).length;
    setConvert(total > 0 ? { done: 0, total } : null);
    const out = [];
    const errors = [];
    let done = 0;
    for (const f of fileList) {
      if (isWavName(f.name)) {
        await new Promise((r) => setTimeout(r, 20)); // 「変換中」の表示を先に出す
        try {
          const p = await prepareWav(f);
          out.push({ name: p.name, kind: "wav", mp3File: p.mp3File, wavFile: p.wavFile, info: p.info });
        } catch (err) {
          console.error(err);
          errors.push({ name: f.name, message: err?.message ?? String(err) });
        }
        done++;
        if (pickToken.current !== token) return;
        setConvert({ done, total });
      } else {
        out.push({ name: f.name, kind: "mp3", mp3File: f });
      }
    }
    if (pickToken.current !== token) return;
    setConvert(null);
    setItems(out);
    setConvertErrors(errors);
  }

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
      // 各記録に、解析した音の種類（wav-48k-16bit／mp3）つきの設定を持たせる
      const params = { ...analysis.meta.params, input: analysis.inputs?.[name] ?? "mp3" };
      for (const r of res.rows) recs.push({ wav_filename: name, ...r, analysis_params: params });
    }
    return { records: recs, errorFiles: errs, speciesCount: new Set(recs.map((r) => r.scientific_name)).size };
  }, [analysis]);

  async function handleAnalyze() {
    setPhase("working");
    setError(null);
    setAnalysis(null);
    setRegisterResult(null);
    setCleanupWarning(null);
    const wavItems = items.filter((i) => i.kind === "wav");
    const mp3Items = items.filter((i) => i.kind === "mp3");
    const uploadedWavs = [];
    try {
      // MP3 は、解析の前に保存して、それを解析する（これまでどおり）
      const failed = await uploadMp3Files(mp3Items.map((i) => i.mp3File), setProgress);
      if (failed.length > 0) {
        throw new Error(`MP3 の保存に失敗しました：${failed.map((f) => `${f.name}（${f.message}）`).join("、")}`);
      }
      // WAV は、解析用（48kHz・16bit）を、一時的に保存する（解析のあとで消す。失敗したものも、念のため、消す対象に入れる）
      uploadedWavs.push(...wavItems.map((i) => i.wavFile.name));
      const failedWav = await uploadAnalysisWavs(wavItems.map((i) => i.wavFile), setProgress);
      if (failedWav.length > 0) {
        throw new Error(`解析用の WAV の保存に失敗しました：${failedWav.map((f) => `${f.name}（${f.message}）`).join("、")}`);
      }

      const analysisName = (i) => (i.kind === "wav" ? i.wavFile.name : i.name); // サーバーに解析してもらう名前
      const a = await analyzeMp3Files({
        names: items.map(analysisName),
        minConf: Number(minConf),
        location: useFilter ? { lat: location.latitude, lon: location.longitude } : null,
        useWeek: useFilter,
        stereo: stereoBest ? "best" : "mix",
        perch: usePerch && useFilter, // Perch は、場所＋時期の種の一覧で絞らないと、日本にいない鳥が上位に出てしまう
        onProgress: setProgress,
      });
      // 結果の名前を、登録する MP3 の名前に直す（WAV の結果は、同じ名前の MP3 の記録として登録する）
      const results = {};
      let warnings = a.warnings;
      for (const i of items) {
        results[i.name] = a.results[analysisName(i)];
        if (i.kind === "wav") warnings = warnings.map((w) => w.replace(i.wavFile.name, i.name));
      }
      const names = items.map((i) => i.name);
      const inputs = Object.fromEntries(items.map((i) => [i.name, inputLabel(i.kind)]));
      const existing = await fetchExistingRecords(names);
      setAnalysis({ ...a, results, warnings, inputs, compare: compareWithExisting(results, existing), names, perchOn: !!a.meta?.perch });
    } catch (err) {
      console.error(err);
      setError(err?.message ?? String(err));
    } finally {
      // 解析用の WAV は、解析のあと（失敗したときも）で、消す
      if (uploadedWavs.length > 0) {
        setProgress({ stage: "cleanup", done: 0, total: uploadedWavs.length });
        try {
          const left = await deleteAnalysisWavs(uploadedWavs);
          if (left.length > 0) setCleanupWarning(`解析用の WAV を消せませんでした（${left.join("、")}）。Supabase の画面（Storage → bird-wav）で消してください。`);
        } catch (err) {
          console.error(err);
          setCleanupWarning(`解析用の WAV を消せませんでした（${uploadedWavs.join("、")}）。Supabase の画面（Storage → bird-wav）で消してください。`);
        }
      }
      setPhase("idle");
      setProgress(null);
    }
  }

  async function handleRegister() {
    setPhase("registering");
    setError(null);
    try {
      const res = await runImport({
        // MP3 は、解析の前に保存済み。WAV から作った再生用の MP3 は、ここで保存する（記録より先に保存し、失敗したら、記録は登録しない）
        mp3Files: items.filter((i) => i.kind === "wav").map((i) => i.mp3File),
        records,
        location: { name: location.name.trim(), latitude: location.latitude, longitude: location.longitude },
        onProgress: setProgress,
        extraColumns: {
          model_name: analysis.meta.model_name,
          model_version: analysis.meta.model_version,
          analyzed_at: analysis.meta.analyzed_at,
        },
      });
      // 登録した録音の一覧（登録後に、そこから編集できるようにする）。記録が無かった録音は、場所が分からず、公開できないので入れない
      const files = analysis.names
        .map((name) => ({ name, rows: analysis.results[name]?.rows ?? [] }))
        .filter((f) => f.rows.length > 0);
      // Perch の意見を、保存する（記録の登録が済んだあと。失敗しても、記録の登録は、そのまま有効）
      let opinions = null;
      if (res.ok && analysis.perchOn) {
        try {
          opinions = { saved: await saveOpinions(opinionRows(analysis.results, analysis.meta)) };
        } catch (err) {
          console.error(err);
          opinions = { error: err?.message ?? String(err) };
        }
      }
      setRegisterResult(res.ok ? { ...res, files, opinions } : res);
      if (res.ok) {
        setItems([]);
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
          MP3 か WAV を選ぶと、サーバー（BirdNET）が解析します。CSV は要りません。先に、上の「場所」を指定してください。
          WAV（192kHz・32bit でも可）は、この画面の中で、48kHz・16bit に変換してから使います（元の WAV は、どこにも送りません。解析のときだけ、変換した WAV を一時的に保存して、解析のあとで消します）。
        </p>
        <label className={pickButtonClass}>
          MP3・WAVを選ぶ
          <input
            key={inputKey}
            type="file"
            multiple
            accept=".mp3,.wav,audio/mpeg,audio/wav,audio/x-wav"
            className="hidden"
            disabled={busy || !!convert}
            onChange={(e) => handlePick([...e.target.files])}
          />
        </label>
        {convert && (
          <p className="mt-2 text-[11px] text-inkMuted leading-relaxed">
            WAV を変換中：{convert.done} / {convert.total}（1本あたり、数秒かかります）
          </p>
        )}
        {items.length > 0 && (
          <div className="mt-2 text-[11px] text-inkMuted leading-relaxed break-all">
            <div>
              {items.length}個{hasWav ? `（WAV ${items.filter((i) => i.kind === "wav").length}個を変換済み）` : ""}
            </div>
            <ul className="mt-1 flex flex-col gap-0.5">
              {items.slice(0, 4).map((i) => (
                <li key={i.name}>
                  {i.name}
                  {i.kind === "wav" &&
                    `（元：${i.info.originalName}・${(i.info.originalRate / 1000).toFixed(0)}kHz・${i.info.originalBits}bit・${
                      i.info.channels === 2 ? "ステレオ" : "モノラル"
                    }・${i.info.durationSec.toFixed(1)}秒・${mb(i.info.originalBytes)}MB → 解析用 ${mb(i.info.wavBytes)}MB・MP3 ${mb(i.info.mp3Bytes)}MB・時刻：${i.info.timeSource}）`}
                </li>
              ))}
              {items.length > 4 && <li>ほか{items.length - 4}個</li>}
            </ul>
          </div>
        )}
        {convertErrors.length > 0 && (
          <ul className="mt-2 text-[11px] text-red-500 leading-relaxed break-all">
            {convertErrors.map((e) => (
              <li key={e.name}>
                {e.name}：{e.message}
              </li>
            ))}
          </ul>
        )}
        {invalidNames.length > 0 && (
          <p className="mt-2 text-[11px] text-red-500 leading-relaxed">
            使えない名前があります（英数字・「.」「_」「-」だけ、拡張子は小文字の .mp3）：{invalidNames.join("、")}
          </p>
        )}
        {duplicateNames.length > 0 && (
          <p className="mt-2 text-[11px] text-red-500 leading-relaxed">
            同じ名前になるファイルがあります（WAV と MP3 の両方を選んでいないか、確認してください）：{duplicateNames.join("、")}
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

        <label className="mt-3 flex items-start gap-2 text-[11px] text-ink leading-relaxed">
          <input
            type="checkbox"
            checked={usePerch && useFilter}
            onChange={(e) => setUsePerch(e.target.checked)}
            disabled={busy || !useFilter}
            className="mt-0.5"
          />
          <span>
            <b>Perch も解析して、「別モデルの意見」を残す</b>（標準：オン）
            <br />
            <span className="text-inkMuted">
              別のモデル（Google の Perch 2.0）が、5秒ごとに、上位の鳥を出します。登録と一緒に保存して、確認画面（管理者だけ）で、BirdNET の判定と見比べられます。「場所と時期で絞り込む」がオンのときだけ使えます。
            </span>
          </span>
        </label>

        <button
          onClick={handleAnalyze}
          disabled={!canAnalyze}
          className="mt-4 w-full rounded-xl bg-[#3F6C74] text-white text-sm font-bold py-3 disabled:opacity-40"
        >
          {phase === "working" ? "解析中…" : hasWav ? "変換した WAV を解析する" : "MP3を保存して解析する"}
        </button>
        {phase === "working" && progress && (
          <p className="mt-2 text-center text-[11px] text-inkMuted leading-relaxed">
            {STAGE_LABEL[progress.stage]}：{progress.done} / {progress.total}
            {progress.stage === "analyze" && "（初回は、サーバーの起動に1分ほどかかります）"}
          </p>
        )}
        {!busy && items.length > 0 && !(location.name.trim() && location.valid) && (
          <p className="mt-2 text-center text-[11px] text-red-500">上の「場所」の名前と緯度経度を指定してください。</p>
        )}
        {error && <p className="mt-2 text-[11px] text-red-500 leading-relaxed break-all">{error}</p>}
        {cleanupWarning && <p className="mt-2 text-[11px] text-red-500 leading-relaxed break-all">⚠ {cleanupWarning}</p>}
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
                  {(() => {
                    const ps = perchSummary(res);
                    if (!ps) return res.perch?.error ? <div className="text-red-500">Perch：{res.perch.error}</div> : null;
                    return (
                      <div>
                        Perch：
                        {ps.total > 0 ? `BirdNET の記録 ${ps.total}件のうち ${ps.same}件が、Perch の上位にもいます` : "BirdNET の記録は、ありません"}
                        {ps.only.length > 0
                          ? `／Perch だけが強く言う鳥：${ps.only.slice(0, 3).map(([n, v]) => `${n}（${v.toFixed(1)}）`).join("、")}`
                          : ""}
                      </div>
                    );
                  })()}
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
            {analysis && Object.values(analysis.inputs ?? {}).includes("wav-48k-16bit") &&
              "WAV から変換した再生用の MP3 も、このとき保存します（同じ名前の MP3 は、上書きされます）。"}
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
              {registerResult.opinions?.saved != null && (
                <p className="mt-1 text-[11px] text-inkMuted leading-relaxed">Perch の意見 {registerResult.opinions.saved}行を保存しました（管理者だけに見えます）。</p>
              )}
              {registerResult.opinions?.error && (
                <p className="mt-1 text-[11px] text-red-500 leading-relaxed break-all">
                  ⚠ Perch の意見を保存できませんでした（{registerResult.opinions.error}）。記録の登録は、済んでいます。管理画面の「Perch」で、あとからかけられます。
                </p>
              )}
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
