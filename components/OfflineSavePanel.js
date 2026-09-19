"use client";

import { useEffect, useState } from "react";
import {
  fetchDetectionsRemote,
  fetchBirdImagesRemote,
  getRemoteAudioUrl,
} from "../lib/queries";
import {
  ensureLoaded,
  getSavedSummary,
  saveOffline,
  clearOffline,
  TOP_PER_SPECIES,
  MIN_CONFIDENCE_PERCENT,
} from "../lib/offline";

function formatSize(bytes) {
  return `${Math.max(1, Math.round((bytes ?? 0) / 1024 / 1024))}MB`;
}

function formatDateTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "―";
  return d.toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

// 🔥 アプリ専用：各鳥の上位の録音と写真を、端末に保存・更新・削除する画面
export default function OfflineSavePanel({ open, onClose, onChanged }) {
  const [summary, setSummary] = useState(null);
  const [phase, setPhase] = useState("idle"); // idle | saving | done | error
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPhase("idle");
    setConfirmDelete(false);
    ensureLoaded().then(() => setSummary(getSavedSummary()));
  }, [open]);

  if (!open) return null;
  const saving = phase === "saving";

  async function handleSave() {
    setPhase("saving");
    setConfirmDelete(false);
    setProgress({ done: 0, total: 0 });

    // 🔥 保存中に画面が消えると、アプリが止まって保存が進まなくなるため、画面を点けたままにする
    let wakeLock = null;
    try {
      wakeLock = (await navigator.wakeLock?.request("screen")) ?? null;
    } catch {
      // 使えない端末では、そのまま進める
    }

    try {
      // 最新の記録データをネットから取り直して、その中から保存する分を選ぶ
      const [detections, birdImages] = await Promise.all([
        fetchDetectionsRemote(),
        fetchBirdImagesRemote(),
      ]);
      const result = await saveOffline({
        detections,
        birdImages: birdImages ?? [],
        getRemoteAudioUrl,
        onProgress: setProgress,
      });
      setSummary(result);
      setPhase("done");
      onChanged?.(); // ホームの写真などを、保存した端末内のファイルに切り替える
    } catch (err) {
      console.error(err);
      setPhase("error");
    } finally {
      wakeLock?.release().catch(() => {});
    }
  }

  async function handleDelete() {
    await clearOffline();
    setSummary(null);
    setConfirmDelete(false);
    setPhase("idle");
    onChanged?.(); // 消したファイルを指さないよう、ホームの写真などをネットの参照先に戻す
  }

  const percent = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center px-5"
      onClick={saving ? undefined : onClose}
    >
      <div className="absolute inset-0 bg-black/55" />
      <div
        className="relative w-full max-w-sm rounded-[28px] bg-black/40 backdrop-blur-2xl border border-white/20 text-white px-6 py-7"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          disabled={saving}
          aria-label="閉じる"
          className="absolute top-4 right-4 w-9 h-9 rounded-full bg-black/30 text-white text-lg flex items-center justify-center disabled:opacity-30"
        >
          ×
        </button>

        <h2 className="font-hero text-2xl text-center">オフライン保存</h2>

        <div className="mt-5 rounded-2xl bg-white/10 px-4 py-3 text-sm leading-relaxed">
          {summary ? (
            <>
              <div className="text-white/60 text-[11px] mb-1">保存済み</div>
              <div>
                {summary.speciesCount}種・{summary.recordCount}件の録音
              </div>
              <div>
                写真 {summary.imageCount}枚・合計 約{formatSize(summary.bytes)}
              </div>
              <div className="text-white/60 text-[11px] mt-1">
                最終更新 {formatDateTime(summary.savedAt)}
              </div>
            </>
          ) : (
            <div className="text-white/70">まだ保存されていません</div>
          )}
        </div>

        <p className="mt-4 text-[11px] leading-relaxed text-white/60">
          各鳥の信頼度{MIN_CONFIDENCE_PERCENT}%以上の上位{TOP_PER_SPECIES}件の録音と、鳥の写真を、この端末に保存します。
          電波が無い場所でも見られるようになります。Wi-Fiでの実行がおすすめです（約100MB）。
        </p>

        {saving && (
          <div className="mt-5">
            <div className="h-1.5 rounded-full bg-white/15 overflow-hidden">
              <div
                className="h-full bg-white/80 transition-all duration-300"
                style={{ width: `${percent}%` }}
              />
            </div>
            <p className="mt-2 text-center text-xs text-white/70">
              保存中… {progress.done} / {progress.total || "―"}
            </p>
            <p className="text-center text-[10px] text-white/40">画面を閉じずにお待ちください</p>
          </div>
        )}

        {phase === "done" && (
          <p className="mt-5 text-center text-xs text-[#B8E0C0]">保存しました。</p>
        )}
        {phase === "error" && (
          <p className="mt-5 text-center text-xs text-[#F0B4AE] leading-relaxed">
            保存に失敗しました。電波の良い場所で、もう一度お試しください。
            <br />
            （保存できた分は、次回そのまま使われます）
          </p>
        )}

        <button
          onClick={handleSave}
          disabled={saving}
          className="mt-5 w-full rounded-xl bg-white/90 text-black text-sm font-medium py-3 disabled:opacity-40"
        >
          {summary ? "更新する" : "保存する"}
        </button>

        {summary && !saving && !confirmDelete && (
          <button
            onClick={() => setConfirmDelete(true)}
            className="mt-3 w-full text-center text-[11px] text-white/50 underline"
          >
            保存を削除
          </button>
        )}
        {summary && !saving && confirmDelete && (
          <div className="mt-3 text-center">
            <p className="text-[11px] text-white/70">保存したデータを、この端末から削除しますか？</p>
            <div className="mt-2 flex gap-2 justify-center">
              <button
                onClick={handleDelete}
                className="rounded-lg bg-[#B5544A] text-white text-xs px-4 py-2"
              >
                削除する
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="rounded-lg bg-white/15 text-white text-xs px-4 py-2"
              >
                やめる
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
