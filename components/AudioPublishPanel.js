"use client";

import { useMemo, useState } from "react";
import { encodeMp3 } from "../lib/mp3";
import {
  editKey,
  exportedName,
  isEditedName,
  fetchSourceLocation,
  uploadExportedMp3,
  markExported,
  markPublished,
  unpublishEdit,
} from "../lib/audioEdits";
import { analyzeMp3Files } from "../lib/analyzerClient";
import { runImport } from "../lib/importData";

const cardClass = "bg-white border-[3px] border-cardBorder rounded-2xl p-4";
const inputClass =
  "w-full px-3 py-2 rounded-xl border-[3px] border-cardBorder bg-white text-sm text-ink outline-none focus:border-accent";

const MIN_CLIP_SEC = 1; // BirdNET が解析できる最小の長さ

const MIN_CONF_OPTIONS = [
  { value: "0.25", label: "0.25（BirdNET の初期値・確かなものだけ）" },
  { value: "0.1", label: "0.1（標準・低い鳥も拾う）" },
  { value: "0.01", label: "0.01（ほぼ全部）" },
];

// 🔥 編集した範囲の「書き出し → 解析 → 公開」（管理者だけ）。
//    ① 保存した設定で音を加工して、MP3 にして、保管場所に保存（名前：<元の名前>_e<連番>.mp3）
//    ② サーバー（BirdNET）で解析して、結果を見る（まだ、みんなには見えない）
//    ③ 「公開する」で、記録を登録する（設定は自分だけに見える）。公開したあとは、「公開を取り下げて、編集し直す」「公開をやめる」ができる（取り下げの間、記録は、みんなから見えない）
//    sel：編集画面の範囲（保存済みで、変更が無いものだけが、書き出せる）／getFocused：加工した音（チャンネルの配列）を返す関数
export default function AudioPublishPanel({ sourceName, sel, normalize, dirty, sampleRate, getFocused, onPublished, onUnpublished }) {
  const [minConf, setMinConf] = useState("0.1");
  const [useFilter, setUseFilter] = useState(true); // 場所＋時期で、鳥を絞り込む（標準：オン）
  const [phase, setPhase] = useState("idle"); // idle | working | publishing
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState(null);
  const [exported, setExported] = useState(null); // { key, name, bytes, location }
  const [analysis, setAnalysis] = useState(null); // { key, results, meta, warnings, elapsedSec }
  const [publishResult, setPublishResult] = useState(null);
  const [confirming, setConfirming] = useState(false); // 「本当に公開しますか？」の確認を出している
  const [unpublishMode, setUnpublishMode] = useState(null); // 取り下げの確認を出している："reedit"（編集し直す）| "stop"（公開をやめる）
  const [unpublishBusy, setUnpublishBusy] = useState(false);
  const [unpublishError, setUnpublishError] = useState(null);
  const [notice, setNotice] = useState(null); // 取り下げたあとの案内

  const name = sel.seq ? exportedName(sourceName, sel.seq) : null; // 保存して連番が決まるまでは、名前も無い
  const currentKey = editKey(sel, normalize);
  const busy = phase !== "idle";

  const blocked = useMemo(() => {
    if (isEditedName(sourceName)) return "編集で書き出した録音は、さらに編集して公開することは、できません。";
    if (!exportedName(sourceName, 1)) return "MP3 の録音だけ、書き出せます。";
    if (sel.dbId == null || dirty) return "先に「💾 設定を保存」してください（保存した設定で、書き出します）。";
    if (sel.t1 - sel.t0 < MIN_CLIP_SEC) return `${MIN_CLIP_SEC}秒より短い範囲は、解析できないので、書き出せません。`;
    return null;
  }, [sourceName, sel.dbId, sel.t0, sel.t1, dirty]);

  // 解析した結果 → 登録する記録・鳥ごとのまとめ
  const result = analysis?.results?.[name] ?? null;
  const records = useMemo(
    () => (result && !result.error ? result.rows.map((r) => ({ wav_filename: name, ...r })) : []),
    [result, name]
  );
  const speciesList = useMemo(() => {
    const bySpecies = new Map();
    for (const r of records) {
      const cur = bySpecies.get(r.scientific_name) ?? { name: r.common_name || r.scientific_name, count: 0, best: 0 };
      cur.count += 1;
      cur.best = Math.max(cur.best, r.confidence);
      bySpecies.set(r.scientific_name, cur);
    }
    return [...bySpecies.values()].sort((a, b) => b.best - a.best);
  }, [records]);
  const stale = !!analysis && analysis.key !== currentKey; // 解析したあとに、設定を変えた

  // 公開を取り下げる（記録を消して、下書きに戻す）。mode："reedit"＝編集し直す／"stop"＝公開をやめる
  async function handleUnpublish(mode) {
    setUnpublishBusy(true);
    setUnpublishError(null);
    try {
      const res = await unpublishEdit(sel.dbId);
      const n = res?.detections_deleted ?? 0;
      setNotice(
        mode === "reedit"
          ? `公開を取り下げました（記録 ${n}件を、みんなの画面から外しました）。長さなどを直して、「設定を保存」→「書き出して、解析する」→「公開する」の順に進むと、もう一度、公開できます。`
          : `公開をやめました（記録 ${n}件を、みんなの画面から外しました）。設定は、下書きとして残っています。不要なら「この範囲を消す」で消せます。もう一度公開するときは、書き出して、解析してから、公開します。`
      );
      setUnpublishMode(null);
      setPublishResult(null);
      setExported(null);
      setAnalysis(null);
      onUnpublished?.(sel.id);
    } catch (err) {
      console.error(err);
      setUnpublishError(`取り下げできませんでした（${err?.message ?? err}）。何も変わっていません。通信やログインの状態を確認して、もう一度お試しください。`);
    } finally {
      setUnpublishBusy(false);
    }
  }

  // 公開済み
  if (sel.published) {
    return (
      <div className={cardClass}>
        <div className="text-xs font-bold text-[#3F6C74]">{publishResult ? "✓ 公開しました" : "🔒 公開済み"}</div>
        <p className="mt-1 text-[11px] text-inkMuted leading-relaxed break-all">
          {sel.exportedName ?? name} として公開しています。
          {publishResult && `記録 ${publishResult.count}件を登録しました（合計 ${publishResult.before}件 → ${publishResult.after}件）。`}
          範囲や下げ方の設定は、自分だけに見えます。公開したものを直したいときは、下のボタンで、公開を取り下げてください（取り下げの間、記録は、みんなから見えません）。
        </p>

        {unpublishMode ? (
          // 確認は、画面の中に出す（ブラウザの確認ダイアログは、出ない環境があるため）
          <div className="mt-3 rounded-xl border-[3px] border-red-300 bg-red-50 p-3">
            <div className="text-xs font-bold text-red-500">
              {unpublishMode === "reedit" ? "公開を取り下げて、編集し直しますか？" : "公開をやめますか？"}
            </div>
            <ul className="mt-1 list-disc pl-4 text-[11px] text-ink leading-relaxed">
              <li>「抽出{sel.seq}」の記録（{sel.exportedName ?? name}）が、みんなの画面から消えます（記録は、削除されます）</li>
              <li>あなたの確認（確定・修正）と、元の録音・書き出した音声ファイルは、残ります</li>
              {unpublishMode === "reedit" ? (
                <li>取り下げたあと、長さなどを直して、もう一度「書き出して、解析する」→「公開する」を行うと、また見えるようになります。直さずに放置すると、見えないままです</li>
              ) : (
                <li>設定は、下書きとして残ります（不要なら「この範囲を消す」で消せます。もう一度公開することもできます）</li>
              )}
            </ul>
            <div className="mt-3 flex gap-2">
              <button
                onClick={() => handleUnpublish(unpublishMode)}
                disabled={unpublishBusy}
                className="flex-1 rounded-xl bg-red-500 text-white text-sm font-bold py-2.5 disabled:opacity-40"
              >
                {unpublishBusy ? "処理中…" : unpublishMode === "reedit" ? "取り下げて、編集し直す" : "公開をやめる"}
              </button>
              <button
                onClick={() => {
                  setUnpublishMode(null);
                  setUnpublishError(null);
                }}
                disabled={unpublishBusy}
                className="flex-1 rounded-xl border-2 border-cardBorder bg-white text-sm font-bold py-2.5 text-[#3F6C74] disabled:opacity-40"
              >
                やめる
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-3 flex flex-col gap-2">
            <button
              onClick={() => setUnpublishMode("reedit")}
              className="w-full rounded-xl bg-[#3F6C74] text-white text-sm font-bold py-2.5"
            >
              ✏ 公開を取り下げて、編集し直す
            </button>
            <button
              onClick={() => setUnpublishMode("stop")}
              className="w-full rounded-xl border-2 border-red-300 bg-white text-red-500 text-sm font-bold py-2.5"
            >
              🚫 公開をやめる
            </button>
          </div>
        )}
        {unpublishError && <p className="mt-2 text-[11px] text-red-500 leading-relaxed break-all">{unpublishError}</p>}
      </div>
    );
  }

  async function handleExportAndAnalyze() {
    setPhase("working");
    setError(null);
    setPublishResult(null);
    setConfirming(false);
    try {
      let ex = exported && exported.key === currentKey ? exported : null;
      if (!ex) {
        setProgress("元の録音の場所を確認しています…");
        const location = await fetchSourceLocation(sourceName);
        if (!location) {
          throw new Error("元の録音の記録（場所）が見つかりません。先に、元の録音の記録を登録してください。");
        }
        setProgress("音を加工して、MP3 にしています…");
        await new Promise((r) => setTimeout(r, 20)); // 表示を先に出す
        const blob = await encodeMp3(getFocused(sel), sampleRate);
        setProgress("MP3 を保管場所に保存しています…");
        await uploadExportedMp3(name, blob);
        await markExported(sel.dbId, name);
        ex = { key: currentKey, name, bytes: blob.size, location };
        setExported(ex);
        setAnalysis(null);
      }
      setProgress("サーバーで解析しています…（初回は、起動に1分ほどかかります）");
      const a = await analyzeMp3Files({
        names: [name],
        minConf: Number(minConf),
        location: useFilter ? { lat: ex.location.latitude, lon: ex.location.longitude } : null,
        useWeek: useFilter,
        stereo: "best",
      });
      setAnalysis({ ...a, key: currentKey });
    } catch (err) {
      console.error(err);
      setError(err?.message ?? String(err));
    } finally {
      setPhase("idle");
      setProgress(null);
    }
  }

  async function handlePublish() {
    if (!analysis || stale || records.length === 0 || !exported) return;
    setConfirming(false);
    setPhase("publishing");
    setError(null);
    try {
      const res = await runImport({
        mp3Files: [], // MP3 は、書き出しのときに保存済み
        records,
        location: exported.location,
        onProgress: (p) => setProgress(`記録を登録しています：${p.done} / ${p.total}`),
        extraColumns: {
          model_name: analysis.meta.model_name,
          model_version: analysis.meta.model_version,
          analyzed_at: analysis.meta.analyzed_at,
          analysis_params: analysis.meta.params,
        },
      });
      if (!res.ok) {
        throw new Error(
          `記録を登録できませんでした${res.recordError ? `（${res.recordError}）` : ""}。ここまでに送った分：${res.recordsSent}件。もう一度「公開する」を押しても、同じ記録は上書きなので安全です。`
        );
      }
      try {
        await markPublished(sel.dbId);
      } catch (err) {
        console.error(err);
        throw new Error(
          `記録は登録されましたが、公開の印を付けられませんでした（${err?.message ?? err}）。もう一度「公開する」を押してください（同じ記録は上書きなので安全です）。`
        );
      }
      setPublishResult({ count: records.length, before: res.before, after: res.after });
      onPublished?.(sel.id, name);
    } catch (err) {
      console.error(err);
      setError(err?.message ?? String(err));
    } finally {
      setPhase("idle");
      setProgress(null);
    }
  }

  return (
    <div className={cardClass}>
      {notice && <p className="mb-3 rounded-xl bg-[#EEF5F6] p-3 text-[11px] text-[#3F6C74] leading-relaxed">{notice}</p>}
      <div className="text-xs font-bold text-ink mb-1">🚀 書き出して、公開する</div>
      <p className="text-[11px] text-inkMuted leading-relaxed">
        保存した設定で音を加工して、MP3 にします（{name ?? "―"}）。サーバーで解析して、結果を確かめてから、公開します。
      </p>

      {blocked ? (
        <p className="mt-3 text-[11px] text-red-500 leading-relaxed">{blocked}</p>
      ) : (
        <>
          <div className="mt-3 text-[11px] font-bold text-ink">信頼度の下限</div>
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
              <span className="text-inkMuted">元の録音の場所と、録音の日付を使って、その場所・その時期にいない鳥を除きます。</span>
            </span>
          </label>

          <button
            onClick={handleExportAndAnalyze}
            disabled={busy}
            className="mt-4 w-full rounded-xl bg-[#3F6C74] text-white text-sm font-bold py-3 disabled:opacity-40"
          >
            {phase === "working" ? "処理中…" : exported && exported.key === currentKey ? "もう一度、解析する" : "書き出して、解析する"}
          </button>
          {busy && progress && <p className="mt-2 text-center text-[11px] text-inkMuted leading-relaxed">{progress}</p>}
        </>
      )}

      {error && <p className="mt-2 text-[11px] text-red-500 leading-relaxed break-all">{error}</p>}

      {analysis && !publishResult && (
        <div className="mt-4 border-t border-cardBorder pt-3">
          <div className="text-xs font-bold text-ink">解析の結果（まだ公開していません）</div>
          <p className="mt-1 text-[11px] text-inkMuted leading-relaxed">
            {analysis.meta.model_name} {analysis.meta.model_version}・下限 {analysis.meta.params.min_conf}・
            {analysis.meta.params.location_filter
              ? `場所${analysis.meta.params.use_week ? "＋時期" : ""}で絞り込み`
              : "絞り込みなし"}
            ・{analysis.meta.params.stereo === "best" ? "ステレオは左右も別々に" : "左右を混ぜた音だけ"}
            ・サーバーの処理 {Math.round(analysis.elapsedSec)}秒
          </p>

          {result?.error ? (
            <p className="mt-2 text-[11px] text-red-500 break-all">解析に失敗しました：{result.error}</p>
          ) : (
            <>
              <p className="mt-2 text-[11px] text-ink font-bold">
                記録 {records.length}件（鳥 {speciesList.length}種）
              </p>
              {speciesList.length === 0 ? (
                <p className="mt-1 text-[11px] text-inkMuted">鳥が見つかりませんでした。下限を下げると、見つかるかもしれません。</p>
              ) : (
                <ul className="mt-1 flex flex-col gap-0.5 text-[11px] text-inkMuted">
                  {speciesList.slice(0, 10).map((s) => (
                    <li key={s.name}>
                      {s.name}：{s.count}件（一番高い信頼度 {Math.round(s.best * 100)}%）
                    </li>
                  ))}
                  {speciesList.length > 10 && <li>ほか {speciesList.length - 10}種</li>}
                </ul>
              )}
            </>
          )}

          {analysis.warnings?.length > 0 && (
            <ul className="mt-2 text-[11px] text-red-500 leading-relaxed">
              {analysis.warnings.map((w) => (
                <li key={w}>⚠ {w}</li>
              ))}
            </ul>
          )}

          {stale ? (
            <p className="mt-3 text-[11px] text-red-500 leading-relaxed">
              設定を変えたので、この結果は使えません。もう一度、書き出して、解析してください。
            </p>
          ) : (
            <>
              {confirming && !busy ? (
                // 確認は、画面の中に出す（ブラウザの確認ダイアログは、出ない環境があるため）
                <div className="mt-4 rounded-xl border-[3px] border-red-300 bg-red-50 p-3">
                  <div className="text-xs font-bold text-red-500">本当に公開しますか？</div>
                  <ul className="mt-1 list-disc pl-4 text-[11px] text-ink leading-relaxed">
                    <li>
                      「抽出{sel.seq}」の記録 {records.length}件（鳥 {speciesList.length}種）が、みんなに見えるようになります
                    </li>
                    <li>公開したあとも、「公開を取り下げて、編集し直す」ことができます（取り下げの間、記録は、みんなから見えなくなります）。元の録音は、そのまま残ります</li>
                    <li>範囲や下げ方の設定は、自分だけに見えます</li>
                  </ul>
                  <div className="mt-3 flex gap-2">
                    <button onClick={handlePublish} className="flex-1 rounded-xl bg-red-500 text-white text-sm font-bold py-2.5">
                      公開する
                    </button>
                    <button
                      onClick={() => setConfirming(false)}
                      className="flex-1 rounded-xl border-2 border-cardBorder bg-white text-sm font-bold py-2.5 text-[#3F6C74]"
                    >
                      やめる
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setConfirming(true)}
                  disabled={busy || records.length === 0 || !!result?.error}
                  className="mt-4 w-full rounded-xl bg-[#3F6C74] text-white text-sm font-bold py-3 disabled:opacity-40"
                >
                  {phase === "publishing" ? "公開中…" : `🚀 公開する（記録 ${records.length}件）`}
                </button>
              )}
              {phase === "publishing" && progress && <p className="mt-2 text-center text-[11px] text-inkMuted">{progress}</p>}
              <p className="mt-2 text-[10px] text-inkMuted leading-relaxed">
                公開すると、記録は、ふつうの録音と同じように、みんなに見えて、集計にも数えられます（「編集（元：{sourceName.replace(/\.mp3$/, "")}）」の印が付きます）。公開したあとも、取り下げて、直せます。
              </p>
            </>
          )}
        </div>
      )}

      {publishResult && (
        <div className="mt-4 border-t border-cardBorder pt-3">
          <div className="text-xs font-bold text-[#3F6C74]">✓ 公開しました</div>
          <p className="mt-1 text-[11px] text-inkMuted leading-relaxed break-all">
            {name}：記録 {publishResult.count}件を登録しました（合計 {publishResult.before}件 → {publishResult.after}件）。
          </p>
        </div>
      )}
    </div>
  );
}
