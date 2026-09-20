"use client";

import { useEffect, useState } from "react";
import { fetchCurrentBirdImage, uploadBirdImage } from "../lib/importData";
import { fetchSpeciesChoices, resetSpeciesChoices } from "../lib/verifications";
import { thumbImageUrl } from "../lib/imageUrl";

const cardClass = "bg-white border-[3px] border-cardBorder rounded-2xl p-4";
const inputClass =
  "w-full px-3 py-2 rounded-xl border-[3px] border-cardBorder bg-white text-sm text-ink outline-none focus:border-accent";

// 🔥 「鳥の写真」の登録（管理者だけ）。鳥を選んで、JPG/PNG をアップロードする（Streamlit の「画像管理」と同じ）
export default function ImportImagePanel() {
  const [birds, setBirds] = useState([]);
  const [bird, setBird] = useState("");
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [currentUrl, setCurrentUrl] = useState(null);
  const [inputKey, setInputKey] = useState(0);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState(null); // { ok, text }

  useEffect(() => {
    fetchSpeciesChoices().then((list) => setBirds(list.map((c) => c.commonName)));
  }, []);

  // 選んだ鳥の、いまの写真（置き換わることが分かるように見せる）
  useEffect(() => {
    let alive = true;
    setCurrentUrl(null);
    if (!bird) return;
    fetchCurrentBirdImage(bird)
      .then((url) => alive && setCurrentUrl(url))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [bird]);

  // 選んだ写真の見本
  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  async function handleUpload() {
    setRunning(true);
    setMessage(null);
    try {
      await uploadBirdImage({ commonName: bird, file });
      resetSpeciesChoices();
      setMessage({ ok: true, text: `${bird} の写真を登録しました。` });
      setFile(null);
      setInputKey((k) => k + 1);
      setCurrentUrl(await fetchCurrentBirdImage(bird));
    } catch (err) {
      console.error(err);
      setMessage({ ok: false, text: `登録できませんでした（${err?.message ?? err}）。` });
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="px-4 pb-6 flex flex-col gap-3">
      <div className={cardClass}>
        <div className="text-xs font-bold text-ink mb-2">🐦 写真を登録する鳥</div>
        <select value={bird} onChange={(e) => setBird(e.target.value)} className={inputClass}>
          <option value="">選んでください</option>
          {birds.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>
        {bird && (
          <div className="mt-3 flex items-center gap-3">
            {currentUrl ? (
              <img
                src={thumbImageUrl(currentUrl)}
                alt={`${bird} のいまの写真`}
                className="w-[72px] h-[72px] rounded-xl object-cover border-2 border-cardBorder"
              />
            ) : (
              <div className="w-[72px] h-[72px] rounded-xl border-2 border-dashed border-cardBorder flex items-center justify-center text-2xl">
                🐦
              </div>
            )}
            <div className="text-[11px] text-inkMuted leading-relaxed">
              {currentUrl ? "いまの写真です。登録すると置き換わります。" : "まだ写真がありません。"}
            </div>
          </div>
        )}
      </div>

      <div className={cardClass}>
        <div className="text-xs font-bold text-ink mb-2">📷 写真（JPG / PNG）</div>
        <label className="inline-block cursor-pointer text-[11px] font-bold rounded-full border-2 border-cardBorder bg-page px-3.5 py-1.5 text-[#3F6C74] hover:border-accent">
          写真を選ぶ
          <input
            key={inputKey}
            type="file"
            accept=".jpg,.jpeg,.png,image/jpeg,image/png"
            className="hidden"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </label>
        {file && (
          <div className="mt-3 flex items-center gap-3">
            {previewUrl && (
              <img src={previewUrl} alt="選んだ写真" className="w-[72px] h-[72px] rounded-xl object-cover border-2 border-cardBorder" />
            )}
            <div className="text-[11px] text-inkMuted break-all leading-relaxed">
              {file.name}（{(file.size / 1024 / 1024).toFixed(1)}MB）
            </div>
          </div>
        )}
        <button
          onClick={handleUpload}
          disabled={running || !bird || !file}
          className="mt-4 w-full rounded-xl bg-[#3F6C74] text-white text-sm font-bold py-3 disabled:opacity-40"
        >
          {running ? "登録中…" : "🚀 写真を登録する"}
        </button>
        {message && (
          <p className={`mt-2 text-center text-[11px] ${message.ok ? "text-[#3F6C74]" : "text-red-500"}`}>{message.text}</p>
        )}
      </div>
    </div>
  );
}
