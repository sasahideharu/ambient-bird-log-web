"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { analyzeMp3Files } from "../lib/analyzerClient";
import { listRecordedFiles, listOpinionFileNames, opinionRows, saveOpinions } from "../lib/modelOpinions";
import { ANALYZER_MAX_FILES } from "../lib/analyzerConfig";

const cardClass = "bg-white border-[3px] border-cardBorder rounded-2xl p-4";

// 🔥 「Perch」（管理者だけ）：すでに登録した録音に、別のモデル Perch をかけて、「別モデルの意見」を保存する。
//    ・対象＝記録のある録音（場所が分かるもの）。同じ場所の録音を、10本ずつまとめて、サーバーに送る（BirdNET は動かさない）
//    ・まだ意見が無い録音だけ（「やり直す」で、全部）。途中で止めても、続きから（意見のある録音は、飛ばす）
//    ・場所＋時期（録音の日付）で、いない鳥は除く（登録のときと同じ）
export default function PerchBackfillPanel() {
  const [files, setFiles] = useState(null); // 記録のある録音：[{ name, latitude, longitude, place }]
  const [done, setDone] = useState(new Set()); // すでに意見のある録音
  const [redo, setRedo] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(null); // { done, total }
  const [summary, setSummary] = useState(null); // { saved（録音の数）, rows, failed: [{ name, message }] }
  const stopRef = useRef(false);

  async function reload() {
    try {
      const [f, d] = await Promise.all([listRecordedFiles(), listOpinionFileNames()]);
      setFiles(f);
      setDone(d);
      setLoadError(null);
    } catch (err) {
      console.error(err);
      setLoadError("録音の一覧を取得できませんでした。通信やログインの状態を確認してください（Perch の表が、まだ無い可能性もあります）。");
    }
  }

  useEffect(() => {
    reload();
  }, []);

  const targets = useMemo(() => (files ?? []).filter((f) => redo || !done.has(f.name)), [files, done, redo]);

  async function handleRun() {
    stopRef.current = false;
    setRunning(true);
    setSummary(null);
    const failed = [];
    let savedFiles = 0;
    let savedRows = 0;

    // 同じ場所ごとに、10本ずつ
    const byPlace = new Map();
    for (const f of targets) {
      const key = `${f.latitude},${f.longitude}`;
      if (!byPlace.has(key)) byPlace.set(key, []);
      byPlace.get(key).push(f);
    }
    const batches = [];
    for (const list of byPlace.values()) {
      for (let i = 0; i < list.length; i += ANALYZER_MAX_FILES) batches.push(list.slice(i, i + ANALYZER_MAX_FILES));
    }

    // 1回分：サーバーで解析して、保存する。つながらなかった・時間切れのときは、半分ずつに分けて、やり直す（1本になっても失敗したら、その録音だけ失敗）
    async function processBatch(batch) {
      try {
        const a = await analyzeMp3Files({
          names: batch.map((f) => f.name),
          minConf: 0.25,
          location: { lat: batch[0].latitude, lon: batch[0].longitude },
          useWeek: true,
          stereo: "mix",
          perch: true,
          birdnet: false,
        });
        const ok = {};
        for (const f of batch) {
          const res = a.results[f.name];
          if (!res || res.error || res.perch?.error || !res.perch?.windows?.length) {
            failed.push({ name: f.name, message: res?.error ?? res?.perch?.error ?? "結果がありません" });
          } else {
            ok[f.name] = res;
          }
        }
        const rows = opinionRows(ok, a.meta);
        if (rows.length > 0) {
          await saveOpinions(rows);
          savedFiles += Object.keys(ok).length;
          savedRows += rows.length;
        }
      } catch (err) {
        console.error(err);
        if (batch.length > 1 && !stopRef.current) {
          const mid = Math.ceil(batch.length / 2);
          await processBatch(batch.slice(0, mid));
          await processBatch(batch.slice(mid));
        } else {
          for (const f of batch) failed.push({ name: f.name, message: err?.message ?? String(err) });
        }
      }
    }

    let processed = 0;
    setProgress({ done: 0, total: targets.length });
    try {
      for (const batch of batches) {
        if (stopRef.current) break;
        await processBatch(batch);
        processed += batch.length;
        setProgress({ done: processed, total: targets.length });
      }
    } finally {
      setSummary({ saved: savedFiles, rows: savedRows, failed, stopped: stopRef.current });
      setRunning(false);
      setProgress(null);
      await reload();
    }
  }

  return (
    <div className="px-4 pb-6 flex flex-col gap-3">
      <div className={cardClass}>
        <div className="text-xs font-bold text-ink mb-1">🔍 Perch（別モデルの意見）</div>
        <p className="text-[11px] text-inkMuted leading-relaxed">
          すでに登録した録音に、別のモデル（Google の Perch 2.0）をかけて、5秒ごとの上位の鳥を保存します。確認画面（管理者だけ）に、「別モデルの意見」として出ます。
          場所と時期で、いない鳥は除きます。BirdNET の記録は、変わりません。
        </p>

        {loadError && <p className="mt-3 text-[11px] text-red-500 leading-relaxed">{loadError}</p>}
        {files && (
          <>
            <p className="mt-3 text-[11px] text-ink font-bold">
              記録のある録音：{files.length}本／意見がある：{files.filter((f) => done.has(f.name)).length}本／これからかける：{targets.length}本
            </p>
            <label className="mt-2 flex items-center gap-2 text-[11px] text-ink">
              <input type="checkbox" checked={redo} onChange={(e) => setRedo(e.target.checked)} disabled={running} />
              意見がある録音も、やり直す（古い意見は、置き換わります）
            </label>
            <div className="mt-3 flex gap-2">
              <button
                onClick={handleRun}
                disabled={running || targets.length === 0}
                className="flex-1 rounded-xl bg-[#3F6C74] text-white text-sm font-bold py-3 disabled:opacity-40"
              >
                {running ? "解析中…" : `Perch をかける（${targets.length}本）`}
              </button>
              {running && (
                <button
                  onClick={() => (stopRef.current = true)}
                  className="rounded-xl border-2 border-cardBorder bg-white text-[#3F6C74] text-sm font-bold px-4"
                >
                  止める
                </button>
              )}
            </div>
            {running && progress && (
              <p className="mt-2 text-center text-[11px] text-inkMuted leading-relaxed">
                {progress.done} / {progress.total} 本（10本ずつ。初回は、サーバーの起動に1分ほどかかります）
              </p>
            )}
          </>
        )}
        {!files && !loadError && <p className="mt-3 text-[11px] text-inkMuted">読み込み中…</p>}
      </div>

      {summary && (
        <div className={`${cardClass} ${summary.failed.length > 0 ? "border-red-300" : ""}`}>
          <div className="text-xs font-bold text-[#3F6C74]">
            {summary.stopped ? "止めました" : "完了しました"}：{summary.saved}本に、意見 {summary.rows}行を保存しました
          </div>
          {summary.failed.length > 0 && (
            <>
              <p className="mt-1 text-[11px] text-red-500">うまくいかなかった録音（{summary.failed.length}本）：</p>
              <ul className="mt-1 text-[11px] text-inkMuted leading-relaxed break-all">
                {summary.failed.slice(0, 10).map((f) => (
                  <li key={f.name}>
                    {f.name}：{f.message}
                  </li>
                ))}
                {summary.failed.length > 10 && <li>ほか {summary.failed.length - 10}本</li>}
              </ul>
              <p className="mt-1 text-[11px] text-inkMuted">もう一度「Perch をかける」を押すと、意見の無い録音だけ、やり直します。</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
