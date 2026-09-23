"use client";

import { useEffect, useMemo, useState } from "react";
import { summarizeStoredLive } from "../lib/liveSpecies";
import { loadSpeciesChoices, addEyeWitness, removeEyeWitness } from "../lib/recordingBirds";
import { loadSpeciesJaNames } from "../lib/speciesNames";
import { canAnalyzeLater, runLaterAnalysis, summarizeLaterAnalysis } from "../lib/laterAnalysis";

const inputClass = "w-full px-3 py-2 rounded-xl border-[3px] border-cardBorder bg-white text-sm text-ink outline-none focus:border-accent";
const smallBtn = "rounded-full border-2 border-cardBorder bg-page px-3 py-1.5 text-[11px] font-bold text-[#3F6C74] hover:border-accent disabled:opacity-40";

// 🔥 録音の「鳥」：①解析（リアルタイム）で出た鳥（参考・読むだけ）②目で見た鳥（これまでの鳥から選ぶ・名前で探す・新しく足す）
//    meta：録音の記録／onSaved(次のmeta)：書き足す・取り消すたびに呼ばれる
export default function RecordingBirdsPanel({ meta, onSaved }) {
  const [choices, setChoices] = useState([]);
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [jaNames, setJaNames] = useState(null); // 学名→和名（古い録音〔和名を保存していない版〕の、日本語表示のため）
  const [laterStage, setLaterStage] = useState(null); // あとで解析：進み具合（null＝動いていない）
  const [laterError, setLaterError] = useState(null);

  useEffect(() => {
    loadSpeciesChoices().then(setChoices);
    loadSpeciesJaNames().then(setJaNames);
  }, []);

  const laterResult = useMemo(() => summarizeLaterAnalysis(meta.laterAnalysis), [meta.laterAnalysis]);
  const laterStageText = { reading: "音を読み込み中…", decoding: "音を元の波形に戻しています…", encoding: "MP3に変換中…", uploading: "送信中…", analyzing: "解析中…（数十秒かかります）" };

  async function startLaterAnalysis() {
    setLaterError(null);
    setLaterStage("reading");
    try {
      const next = await runLaterAnalysis(meta, { onProgress: (p) => setLaterStage(p.stage) });
      onSaved?.(next);
    } catch (err) {
      console.error(err);
      setLaterError(err?.message ?? String(err));
    } finally {
      setLaterStage(null);
    }
  }

  const detected = useMemo(() => {
    const list = summarizeStoredLive(meta.live);
    if (!jaNames) return list;
    return list.map((s) => (s.common ? s : { ...s, common: jaNames.get(s.sci) ?? null }));
  }, [meta.live, jaNames]);
  const witnessed = meta.eyeWitness ?? [];

  // 名前で探す：入力した文字を含む名前だけ（和名・学名の両方から）
  const filtered = useMemo(() => {
    const q = text.trim();
    if (!q) return choices.slice(0, 8);
    return choices.filter((c) => c.commonName.includes(q) || (c.scientificName ?? "").toLowerCase().includes(q.toLowerCase())).slice(0, 8);
  }, [choices, text]);

  async function pick(choice) {
    setSaving(true);
    setError(null);
    try {
      const next = await addEyeWitness(meta, { commonName: choice.commonName, scientificName: choice.scientificName });
      setText("");
      setAdding(false);
      onSaved?.(next);
    } catch (err) {
      console.error(err);
      setError(err?.message ?? String(err));
    } finally {
      setSaving(false);
    }
  }

  async function addNew() {
    if (!text.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      const next = await addEyeWitness(meta, { commonName: text });
      setText("");
      setAdding(false);
      onSaved?.(next);
    } catch (err) {
      console.error(err);
      setError(err?.message ?? String(err));
    } finally {
      setSaving(false);
    }
  }

  async function remove(index) {
    setSaving(true);
    try {
      const next = await removeEyeWitness(meta, index);
      onSaved?.(next);
    } catch (err) {
      console.error(err);
      setError(err?.message ?? String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-2 rounded-xl border-[3px] border-cardBorder bg-page p-3">
      <div className="text-xs font-bold text-ink">🐦 鳥</div>

      <div className="mt-2 text-[11px] font-bold text-ink">解析で見つかった鳥（参考）</div>
      {detected.length === 0 ? (
        <p className="mt-1 text-[11px] leading-relaxed text-inkMuted">
          {meta.live ? "見つかりませんでした。" : "この録音は、リアルタイム解析をしていません（あとで解析すると、分かります）。"}
        </p>
      ) : (
        <ul className="mt-1 flex flex-col gap-1">
          {detected.map((s) => (
            <li key={s.sci} className={`rounded-lg px-2 py-1 text-[11px] leading-relaxed ${s.agreed ? "bg-[#DDF3E4] text-[#1F5E3A] font-bold" : "text-inkMuted"}`}>
              {s.agreed && "✓ "}
              {s.common ?? s.sci}
              {s.agreed && <span className="ml-1">（両方が一致）</span>}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-1 text-[10px] leading-relaxed text-inkMuted">音だけの解析です。正式な記録ではありません。</p>

      <div className="mt-3 text-[11px] font-bold text-ink">あとで解析（本番と同じ解析）</div>
      {meta.laterAnalysis ? (
        <>
          <p className="mt-1 text-[10px] text-inkMuted">{new Date(meta.laterAnalysis.analyzedAt).toLocaleString("ja-JP")} に解析</p>
          {laterResult.length === 0 ? (
            <p className="mt-1 text-[11px] leading-relaxed text-inkMuted">見つかりませんでした。</p>
          ) : (
            <ul className="mt-1 flex flex-col gap-1">
              {laterResult.map((s) => (
                <li key={s.sci} className="rounded-lg bg-[#DDF3E4] px-2 py-1 text-[11px] font-bold leading-relaxed text-[#1F5E3A]">
                  {s.common ?? s.sci}（{Math.round(s.confidence * 100)}%）
                </li>
              ))}
            </ul>
          )}
          <p className="mt-1 text-[10px] leading-relaxed text-inkMuted">音だけの解析です。まだ登録（公開）はされていません。</p>
        </>
      ) : canAnalyzeLater(meta) ? (
        <p className="mt-1 text-[11px] leading-relaxed text-inkMuted">まだ、していません。</p>
      ) : (
        <p className="mt-1 text-[11px] leading-relaxed text-inkMuted">この録音は、途中で止まったため、あとで解析できません。</p>
      )}
      {canAnalyzeLater(meta) && (
        <button onClick={startLaterAnalysis} disabled={!!laterStage} className={`${smallBtn} mt-2`}>
          {laterStage ? laterStageText[laterStage] : meta.laterAnalysis ? "☁ もう一度解析する" : "☁ あとで解析する"}
        </button>
      )}
      {laterError && <p className="mt-1.5 text-[11px] leading-relaxed text-red-500">{laterError}</p>}

      <div className="mt-3 text-[11px] font-bold text-ink">目で見た鳥</div>
      {witnessed.length === 0 ? (
        <p className="mt-1 text-[11px] text-inkMuted">まだ、ありません。</p>
      ) : (
        <ul className="mt-1 flex flex-col gap-1">
          {witnessed.map((w, i) => (
            <li key={i} className="flex items-center justify-between gap-2 rounded-lg bg-white px-2 py-1.5 text-[11px]">
              <span className="min-w-0 break-words text-ink">
                {w.commonName}
                {w.note && <span className="ml-1 text-inkMuted">（{w.note}）</span>}
              </span>
              <button onClick={() => remove(i)} disabled={saving} className="shrink-0 text-[10px] font-bold text-red-500 disabled:opacity-40">
                取り消す
              </button>
            </li>
          ))}
        </ul>
      )}

      {!adding ? (
        <button className={`${smallBtn} mt-2`} onClick={() => setAdding(true)}>
          ＋ 目で見た鳥を足す
        </button>
      ) : (
        <div className="mt-2">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              // 日本語の変換を確定する Enter では、追加しない
              if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                e.preventDefault();
                addNew();
              }
            }}
            placeholder="鳥の名前（例：メジロ）"
            maxLength={40}
            autoFocus
            className={inputClass}
          />
          {filtered.length > 0 && (
            <ul className="mt-1.5 flex flex-col gap-1">
              {filtered.map((c) => (
                <button
                  key={c.commonName}
                  onClick={() => pick(c)}
                  disabled={saving}
                  className="rounded-lg border-2 border-cardBorder bg-white px-3 py-1.5 text-left text-[11px] font-bold text-ink hover:border-accent disabled:opacity-40"
                >
                  {c.commonName}
                </button>
              ))}
            </ul>
          )}
          {choices.length === 0 && <p className="mt-1.5 text-[10px] leading-relaxed text-inkMuted">これまでの鳥の名前が、まだ読み込めていません。名前を入れて「追加する」で、新しく足せます。</p>}
          {error && <p className="mt-1.5 text-[11px] leading-relaxed text-red-500">{error}</p>}
          <div className="mt-2 flex gap-2">
            <button onClick={addNew} disabled={saving || !text.trim()} className="flex-1 rounded-xl bg-[#3F6C74] py-2 text-[12px] font-bold text-white disabled:opacity-40">
              {saving ? "追加中…" : `「${text.trim() || "…"}」を追加する`}
            </button>
            <button
              onClick={() => {
                setAdding(false);
                setText("");
                setError(null);
              }}
              disabled={saving}
              className="flex-1 rounded-xl border-2 border-cardBorder bg-white py-2 text-[12px] font-bold text-[#3F6C74]"
            >
              やめる
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
