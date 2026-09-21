"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import BackLink from "./BackLink";
import RecordingPlaceEditor from "./RecordingPlaceEditor";
import { useLoginState } from "../lib/useLoginState";
import { isNativeApp } from "../lib/offline";
import { deleteRecording, listRecordings, playableUrl } from "../lib/recordingStore";
import { deviceLabel } from "../lib/deviceInfo";

const card = "mx-4 mt-2.5 mb-3 bg-white border-[3px] border-cardBorder rounded-2xl p-4";
const smallBtn = "rounded-full border-2 border-cardBorder bg-page px-3 py-1.5 text-[11px] font-bold text-[#3F6C74] hover:border-accent disabled:opacity-40";

const mmss = (sec) => {
  const s = Math.max(0, Math.floor(sec ?? 0));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};
const mb = (bytes) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)}MB` : `${Math.round((bytes ?? 0) / 1024)}KB`);

function whenText(meta) {
  const d = new Date(meta.startedAtMs);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// 場所が、録音したときから変わっているか（変えたあと、元に戻したときは、変わっていない）
function locationChanged(meta) {
  const o = meta.locationOriginal;
  const l = meta.location;
  if (!o || !l) return false;
  return o.latitude !== l.latitude || o.longitude !== l.longitude || (o.name ?? null) !== (l.name ?? null);
}

function locationText(l) {
  if (!l || l.latitude == null) return "場所なし";
  const src = l.source === "gps" ? "GPS" : l.source === "default" ? "デフォルト" : "手入力";
  return `${l.name || "名前なし"}（${src}・${l.latitude.toFixed(3)}, ${l.longitude.toFixed(3)}）`;
}

function Item({ meta, onDelete, onChanged }) {
  const [url, setUrl] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [editingPlace, setEditingPlace] = useState(false);
  const [busy, setBusy] = useState(false);
  const files = meta._files ?? { pcm: (meta.audio?.pcm?.samples ?? 0) * 2, aac: meta.audio?.aac?.bytes ?? 0 };
  const unfinished = meta.status === "recording"; // 録音中に、アプリが止まったもの
  const master = meta.audio?.master;

  return (
    <div className={card}>
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-sm font-bold text-ink">{whenText(meta)}</div>
        <div className="text-[11px] font-bold tabular-nums text-inkMuted">{mmss(meta.durationSec)}</div>
      </div>
      <ul className="mt-1 text-[11px] leading-relaxed text-inkMuted">
        <li>
          📍 {locationText(meta.location)}
          {locationChanged(meta) && <span className="ml-1 text-[#2F8050]">（変更済み）</span>}
        </li>
        {meta.note && <li>📝 {meta.note}</li>}
        <li>🎙 {meta.recorder?.name ? `${meta.recorder.name}・` : ""}{deviceLabel(meta.device)}{meta.audio?.inputLabel ? `・${meta.audio.inputLabel}` : ""}</li>
        <li>
          🎧 正式な録音：{unfinished ? "（録音が、途中で止まりました）" : master === "aac" ? "別の録音（AAC）※無圧縮が途切れたため" : "無圧縮"}
          {meta.audio?.pcm?.coverage != null && `（無圧縮 ${Math.round(meta.audio.pcm.coverage * 100)}%）`}
        </li>
        <li>
          💾 無圧縮 {mb(files.pcm)}・AAC {mb(files.aac)}
        </li>
        {meta.status === "error" && <li className="text-red-500">端末への書き込みに失敗しました（そこまでは保存）</li>}
      </ul>

      {url ? (
        <audio controls src={url} className="mt-2 w-full" />
      ) : (
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            className={smallBtn}
            disabled={!files.aac && !meta.audio?.aac?.bytes}
            onClick={async () => setUrl(await playableUrl(meta.id, "aac"))}
          >
            ▶ 聞く
          </button>
          {!editingPlace && (
            <button className={smallBtn} onClick={() => setEditingPlace(true)}>
              📍 場所を変える
            </button>
          )}
          {!confirming && (
            <button className={`${smallBtn} !text-red-500`} onClick={() => setConfirming(true)}>
              削除
            </button>
          )}
        </div>
      )}
      {url && !editingPlace && (
        <button className={`${smallBtn} mt-2 mr-2`} onClick={() => setEditingPlace(true)}>
          📍 場所を変える
        </button>
      )}
      {editingPlace && (
        <RecordingPlaceEditor
          meta={meta}
          onCancel={() => setEditingPlace(false)}
          onSaved={() => {
            setEditingPlace(false);
            onChanged();
          }}
        />
      )}
      {url && !confirming && (
        <button className={`${smallBtn} mt-2 !text-red-500`} onClick={() => setConfirming(true)}>
          削除
        </button>
      )}
      {confirming && (
        <div className="mt-2 rounded-xl border-[3px] border-red-300 bg-red-50 p-3">
          <div className="text-xs font-bold text-red-500">この録音を削除しますか？</div>
          <p className="mt-1 text-[11px] text-ink leading-relaxed">端末の中の録音（無圧縮・AAC）と、記録が、消えます。元に戻せません。</p>
          <div className="mt-2 flex gap-2">
            <button
              className="flex-1 rounded-xl bg-red-500 py-2 text-[12px] font-bold text-white disabled:opacity-40"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                await onDelete(meta.id);
              }}
            >
              {busy ? "削除中…" : "削除する"}
            </button>
            <button className="flex-1 rounded-xl border-2 border-cardBorder bg-white py-2 text-[12px] font-bold text-[#3F6C74]" onClick={() => setConfirming(false)} disabled={busy}>
              やめる
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// 🔥 録音の一覧（この端末に保存してある録音）。聞く・削除
export default function RecordingsList() {
  const login = useLoginState();
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const native = isNativeApp();

  const reload = useCallback(async () => {
    try {
      setItems(await listRecordings());
    } catch (err) {
      console.error(err);
      setError(err?.message ?? String(err));
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const total = (items ?? []).reduce((n, m) => n + (m._files?.pcm ?? 0) + (m._files?.aac ?? 0), 0);

  return (
    <div className="abl-page-safe min-h-screen w-full flex justify-center bg-page px-6">
      <div className="w-full max-w-sm bg-page rounded-[28px] border-[6px] border-white shadow-xl overflow-hidden pb-6">
        <BackLink fallbackHref="/" className="block px-4 pt-4 text-xs font-bold text-[#3F6C74]">
          ‹ 戻る
        </BackLink>
        <div className={card}>
          <div className="font-display text-xl">録音の一覧</div>
          <p className="mt-1 text-[11px] text-inkMuted leading-relaxed">この端末に保存してある録音です。{items && items.length > 0 && `（${items.length}件・合計 ${mb(total)}）`}</p>
          {login.ready && !login.loggedIn && <p className="mt-2 text-[11px] text-red-500">この画面は、ログイン中の人だけが使えます。</p>}
          {!native && <p className="mt-2 text-[10px] text-[#C2860A] leading-relaxed">ブラウザでは、録音は保存されません（試験用）。</p>}
          <Link href="/record" className="mt-3 block rounded-xl bg-[#D9534F] py-2.5 text-center text-[12px] font-bold text-white">
            ● 録音する
          </Link>
        </div>
        {error && <p className="mx-4 text-[11px] text-red-500">{error}</p>}
        {items === null && !error && <p className="text-center text-xs text-inkMuted py-6">読み込み中…</p>}
        {items?.length === 0 && <p className="text-center text-xs text-inkMuted py-6">まだ、録音がありません。</p>}
        {items?.map((m) => (
          <Item
            key={m.id}
            meta={m}
            onChanged={reload}
            onDelete={async (id) => {
              await deleteRecording(id);
              await reload();
            }}
          />
        ))}
      </div>
    </div>
  );
}
