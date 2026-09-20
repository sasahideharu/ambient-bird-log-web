"use client";

import { useEffect, useMemo, useState } from "react";
import {
  saveVerification,
  deleteVerification,
  fetchSpeciesChoices,
  resetSpeciesChoices,
  VERIFY_METHODS,
} from "../lib/verifications";

const OPTIONS = [
  { value: "confirmed", title: "合っている（確定）", hint: "この鳥で間違いない。信頼度の代わりに「確定」と表示します" },
  { value: "corrected", title: "別の鳥だった", hint: "正しい鳥を選びます" },
  { value: "rejected", title: "鳥の声ではない・誤検出", hint: "この記録を、一覧から消します" },
];

// 🔥 録音1件ごとの「確認」の画面（ログイン中の本人だけ）。確定・修正・除外を選んで保存する
export default function VerifyPanel({ open, record, onClose, onSaved }) {
  const existing = record.verification;
  const [choice, setChoice] = useState("confirmed");
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState(null); // { commonName, scientificName }
  const [method, setMethod] = useState("heard");
  const [note, setNote] = useState("");
  const [choices, setChoices] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // 開くたびに、いまの判断で初期化する
  useEffect(() => {
    if (!open) return;
    setError(null);
    setBusy(false);
    setChoice(existing?.status ?? "confirmed");
    setMethod(existing?.method ?? "heard");
    setNote(existing?.note ?? "");
    setPicked(
      existing?.status === "corrected"
        ? { commonName: record.species, scientificName: record.scientificName }
        : null
    );
    setQuery("");
    fetchSpeciesChoices().then(setChoices);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const trimmed = query.trim();
  const matches = useMemo(
    () =>
      choices
        .filter((c) => c.commonName !== record.originalCommonName && (trimmed === "" || c.commonName.includes(trimmed)))
        .slice(0, 8),
    [choices, trimmed, record.originalCommonName]
  );
  const canUseNewName =
    trimmed !== "" && !choices.some((c) => c.commonName === trimmed) && trimmed !== record.originalCommonName;

  if (!open) return null;

  async function handleSave() {
    if (choice === "corrected" && !picked) {
      setError("正しい鳥を選んでください。");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await saveVerification({
        record,
        status: choice,
        verifiedCommonName: picked?.commonName ?? null,
        verifiedScientificName: picked?.scientificName ?? null,
        method,
        note,
      });
      resetSpeciesChoices();
      onSaved?.();
      onClose();
    } catch (err) {
      console.error(err);
      setError("保存できませんでした。ログインの状態や通信を確認して、もう一度お試しください。");
      setBusy(false);
    }
  }

  async function handleUndo() {
    if (!existing?.id) return;
    setBusy(true);
    setError(null);
    try {
      await deleteVerification(existing.id);
      onSaved?.();
      onClose();
    } catch (err) {
      console.error(err);
      setError("取り消せませんでした。通信を確認して、もう一度お試しください。");
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center px-5"
      style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}
      onClick={busy ? undefined : onClose}
    >
      <div className="absolute inset-0 bg-black/60" />
      <div
        className="relative w-full max-w-sm max-h-[88vh] overflow-y-auto rounded-[28px] bg-[#16181a]/90 backdrop-blur-2xl border border-white/20 text-white px-6 py-7"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          disabled={busy}
          aria-label="閉じる"
          className="absolute top-4 right-4 w-9 h-9 rounded-full bg-black/30 text-white text-lg flex items-center justify-center disabled:opacity-30"
        >
          ×
        </button>

        <h2 className="font-hero text-2xl text-center">この録音を確認</h2>
        <p className="mt-2 text-center text-[11px] text-white/60 leading-relaxed">
          BirdNET の判定：{record.originalCommonName}（信頼度 {record.originalConfidence}%）
        </p>

        <div className="mt-5 flex flex-col gap-2">
          {OPTIONS.map((o) => (
            <button
              key={o.value}
              onClick={() => setChoice(o.value)}
              className={`text-left rounded-xl px-4 py-3 border transition-colors ${
                choice === o.value ? "bg-white/20 border-white/60" : "bg-white/5 border-white/15"
              }`}
            >
              <div className="text-sm font-medium">{o.title}</div>
              <div className="text-[10px] text-white/55 mt-0.5">{o.hint}</div>
            </button>
          ))}
        </div>

        {choice === "corrected" && (
          <div className="mt-4">
            <label className="block text-[11px] text-white/60">正しい鳥</label>
            {picked && (
              <div className="mt-1 mb-2 rounded-lg bg-white/15 px-3 py-2 text-sm flex justify-between items-center">
                <span>{picked.commonName}</span>
                <button onClick={() => setPicked(null)} className="text-[11px] text-white/60 underline">
                  選び直す
                </button>
              </div>
            )}
            {!picked && (
              <>
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="和名で検索（例：メジロ）"
                  className="mt-1 w-full rounded-xl bg-white/10 px-4 py-2.5 text-sm text-white placeholder:text-white/40 outline-none focus:bg-white/15"
                />
                <div className="mt-2 flex flex-col gap-1">
                  {matches.map((c) => (
                    <button
                      key={c.commonName}
                      onClick={() => setPicked({ commonName: c.commonName, scientificName: c.scientificName })}
                      className="text-left rounded-lg bg-white/8 hover:bg-white/15 px-3 py-2 text-sm"
                    >
                      {c.commonName}
                      {c.scientificName && (
                        <span className="ml-2 text-[10px] italic text-white/45">{c.scientificName}</span>
                      )}
                    </button>
                  ))}
                  {canUseNewName && (
                    <button
                      onClick={() => setPicked({ commonName: trimmed, scientificName: null })}
                      className="text-left rounded-lg border border-dashed border-white/30 px-3 py-2 text-sm"
                    >
                      「{trimmed}」を、新しい鳥の名前として使う
                    </button>
                  )}
                  {matches.length === 0 && !canUseNewName && (
                    <p className="text-[11px] text-white/50 px-1 py-1">該当する鳥がありません</p>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {choice !== "rejected" && (
          <div className="mt-4">
            <label className="block text-[11px] text-white/60">根拠（自分にだけ見えます）</label>
            <div className="mt-1 flex gap-2 flex-wrap">
              {VERIFY_METHODS.map((m) => (
                <button
                  key={m.value}
                  onClick={() => setMethod(m.value)}
                  className={`rounded-full px-3 py-1.5 text-xs border transition-colors ${
                    method === m.value ? "bg-white/25 border-white/60" : "bg-white/5 border-white/15"
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="mt-4">
          <label className="block text-[11px] text-white/60">メモ（任意・自分にだけ見えます）</label>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="mt-1 w-full rounded-xl bg-white/10 px-4 py-2.5 text-sm text-white outline-none focus:bg-white/15"
          />
        </div>

        {error && <p className="mt-4 text-center text-xs text-[#F0B4AE]">{error}</p>}

        <button
          onClick={handleSave}
          disabled={busy}
          className="mt-5 w-full rounded-xl bg-white/90 text-black text-sm font-medium py-3 disabled:opacity-40"
        >
          {busy ? "保存中…" : "保存する"}
        </button>
        {existing?.id && (
          <button
            onClick={handleUndo}
            disabled={busy}
            className="mt-3 w-full text-center text-[11px] text-white/50 underline disabled:opacity-40"
          >
            判断を取り消して、BirdNET の結果に戻す
          </button>
        )}
      </div>
    </div>
  );
}
