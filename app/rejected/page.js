"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { fetchRejectedRemote, getAudioUrl } from "../../lib/queries";
import { deleteVerification } from "../../lib/verifications";
import { toRecord } from "../../lib/record";
import AudioSpectrogramCard from "../../components/AudioSpectrogramCard";
import { useSystemBars } from "../../lib/useSystemBars";
import { useLoginState } from "../../lib/useLoginState";

// 🔥 「除外した記録」の一覧（ログイン中の本人だけ）。
//    除外すると、どの一覧からも消えて戻す入口が無くなるため、ここから「元に戻す」（除外の取り消し）ができる。
//    戻すと、BirdNET の元の結果で、一覧に再び出る
export default function RejectedPage() {
  useSystemBars("light"); // 明るい背景：バーの文字は黒
  const login = useLoginState();

  const [records, setRecords] = useState(null); // null＝読み込み前
  const [loadError, setLoadError] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [busyId, setBusyId] = useState(null);
  const [actionError, setActionError] = useState(null);

  useEffect(() => {
    if (!login.ready || !login.loggedIn) return;
    async function load() {
      try {
        const rows = await fetchRejectedRemote();
        setRecords(rows.map(toRecord).sort((a, b) => (a.isoDate < b.isoDate ? 1 : -1)));
        setLoadError(null);
      } catch (err) {
        console.error(err);
        setLoadError("データの取得に失敗しました。通信を確認してください。");
      }
    }
    load();
  }, [login.ready, login.loggedIn, reloadKey]);

  async function handleRestore(record) {
    setBusyId(record.id);
    setActionError(null);
    try {
      await deleteVerification(record.verification.id);
      setReloadKey((k) => k + 1);
    } catch (err) {
      console.error(err);
      setActionError("元に戻せませんでした。通信やログインの状態を確認して、もう一度お試しください。");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="abl-page-safe min-h-screen w-full flex justify-center bg-page px-6">
      <div className="w-full max-w-sm bg-page rounded-[28px] border-[6px] border-white shadow-xl overflow-hidden">
        <Link href="/admin" className="block px-4 pt-4 text-xs font-bold text-[#3F6C74]">
          ‹ 管理画面に戻る
        </Link>

        <div className="mx-4 mt-2.5 mb-3 bg-white border-[3px] border-cardBorder rounded-2xl p-4">
          <div className="font-display text-xl">除外した記録</div>
          <div className="text-[11px] text-inkMuted font-bold mt-0.5 leading-relaxed">
            「誤検出」として除外した記録です。元に戻すと、BirdNET の結果のまま、一覧に再び出ます。
          </div>
        </div>

        {!login.ready && <p className="text-center text-xs text-inkMuted py-10">読み込み中...</p>}
        {login.ready && !login.loggedIn && (
          <p className="text-center text-xs text-inkMuted py-10 px-6">
            この画面は、ログイン中の人だけが見られます。
          </p>
        )}
        {loadError && <p className="text-center text-xs text-red-500 py-10 px-6">{loadError}</p>}
        {login.loggedIn && !loadError && records === null && (
          <p className="text-center text-xs text-inkMuted py-10">読み込み中...</p>
        )}

        {login.loggedIn && !loadError && records !== null && (
          <div className="px-4 pb-5 flex flex-col gap-3">
            {actionError && <p className="text-center text-xs text-red-500 px-2">{actionError}</p>}
            {records.map((r) => (
              <div key={r.id} className="bg-white border-[3px] border-cardBorder rounded-2xl p-3.5">
                <div className="flex justify-between items-baseline mb-2">
                  <div className="text-[10px] tracking-wide text-accentText font-black">
                    {r.originalCommonName}
                  </div>
                  <div className="text-[11px] text-[#3F6C74] font-bold">
                    識別信頼度 {r.originalConfidence}%
                  </div>
                </div>
                <AudioSpectrogramCard
                  src={getAudioUrl(r.wavFilename)}
                  startSec={r.startSec}
                  endSec={r.endSec}
                />
                <div className="flex gap-1.5 mt-2 flex-wrap">
                  <span className="text-[10px] font-bold bg-page border-2 border-cardBorder rounded-lg px-2 py-1">
                    📅 {r.date}
                  </span>
                  <span className="text-[10px] font-bold bg-page border-2 border-cardBorder rounded-lg px-2 py-1">
                    📍 {r.location}
                  </span>
                  <span className="text-[10px] font-bold bg-page border-2 border-cardBorder rounded-lg px-2 py-1">
                    🕒 {r.time}
                  </span>
                </div>
                <div className="mt-3">
                  <button
                    onClick={() => handleRestore(r)}
                    disabled={busyId !== null}
                    className="text-[11px] font-bold rounded-full border-2 border-cardBorder bg-page px-3.5 py-1.5 text-[#3F6C74] hover:border-accent disabled:opacity-40"
                  >
                    {busyId === r.id ? "戻しています…" : "元に戻す"}
                  </button>
                </div>
              </div>
            ))}
            {records.length === 0 && (
              <div className="text-center text-xs text-inkMuted py-6">除外した記録はありません</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
