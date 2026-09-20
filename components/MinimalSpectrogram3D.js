"use client";

import { useEffect, useRef, useState } from "react";
import { createViewer } from "../lib/spectrogram3d";
import { loadSpectrogram } from "../lib/spectrogram3dData";

// 横長（3:2）のカードに、3D の箱が小さく収まりすぎないよう、少し寄る（1より小さいほど、寄る）
const INLINE_ZOOM = 0.72;

// 秒数を「0:03」のような表示に変換する
function formatTime(sec) {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

// 🔥 ミニマルトップページ用の、3D スペクトログラム（縦＝周波数・横＝左右・奥＝時間）。一覧の中に置くので、指で回す操作は付けない
//    （スクロールの邪魔をしないため。回したいときは「大きく見る」）。3D（ななめ）のまま、再生ボタン・再生位置の線・時間の表示は、2D のカードと同じ。
//    3D が使えないとき（WebGL が無い・範囲が短すぎる・音を取得できない）は、onUnavailable で親に知らせる（親が2D に切り替える）
export default function MinimalSpectrogram3D({ src, startSec, endSec, onUnavailable, onPlayingChange }) {
  const boxRef = useRef(null);
  const canvasRef = useRef(null);
  const audioRef = useRef(null);
  const clockRef = useRef(null);
  const viewerRef = useRef(null);
  const dataRef = useRef(null);
  const headShownRef = useRef(false); // 再生位置の線を、いま出しているか
  const startRef = useRef(startSec ?? 0);
  const unavailableRef = useRef(onUnavailable);
  unavailableRef.current = onUnavailable;

  const [status, setStatus] = useState("loading"); // loading | ready
  const [playing, setPlaying] = useState(false);

  const durationSec = Math.max(0, (endSec ?? 0) - (startSec ?? 0));

  function showClock(t, duration) {
    if (clockRef.current) clockRef.current.textContent = `${formatTime(t)} / ${formatTime(duration)}`;
  }

  // ---------- 描画の準備（出てきたとき／片づけるとき） ----------
  useEffect(() => {
    const audio = audioRef.current;
    let viewer;
    try {
      viewer = createViewer({
        canvas: canvasRef.current,
        interactive: false,
        onFrame: () => {
          const a = audioRef.current;
          const d = dataRef.current;
          const v = viewerRef.current;
          if (!a || !d || !v) return;
          // 再生位置の線は、再生中だけ出す
          const playingNow = !a.paused && !a.ended;
          if (playingNow !== headShownRef.current) {
            headShownRef.current = playingNow;
            v.setPlayheadVisible(playingNow);
          }
          if (!playingNow) return;
          const start = startRef.current;
          // 範囲の終わりまで来たら、止めて、最初へ戻す
          if (a.currentTime >= start + d.duration - 0.02) {
            a.pause();
            a.currentTime = start;
            setPlaying(false);
            showClock(0, d.duration);
            return;
          }
          const t = Math.max(0, a.currentTime - start);
          v.setPlayhead(t);
          showClock(t, d.duration);
        },
      });
    } catch (err) {
      console.error(err);
      unavailableRef.current?.(); // WebGL が使えない
      return;
    }
    viewer.set({ zoom: INLINE_ZOOM });
    viewerRef.current = viewer;

    const box = boxRef.current;
    const doResize = () => viewer.resize(box.clientWidth, box.clientHeight, 0);
    const ro = new ResizeObserver(doResize);
    ro.observe(box);
    doResize();

    return () => {
      ro.disconnect();
      viewer.dispose(); // 描画の枠（WebGL）を返す。一覧に、たくさん並ぶので、見えなくなったものは片づける
      viewerRef.current = null;
      audio?.pause();
    };
  }, []);

  // ---------- 録音を読み込む ----------
  useEffect(() => {
    let cancelled = false;
    if (!viewerRef.current) return; // 描画の準備ができなかった（親に知らせ済み）
    if (!src) {
      unavailableRef.current?.();
      return;
    }
    setStatus("loading");
    loadSpectrogram(src, startSec, endSec)
      .then((data) => {
        const v = viewerRef.current;
        if (cancelled || !v) return;
        dataRef.current = data;
        startRef.current = Math.max(0, startSec ?? 0);
        v.setData(data); // 周波数の上限は、録音から自動で計算される
        setStatus("ready");
      })
      .catch((err) => {
        console.error(err);
        if (!cancelled) unavailableRef.current?.();
      });
    return () => {
      cancelled = true;
    };
  }, [src, startSec, endSec]);

  // 再生中かどうかを、親に知らせる（再生中は、スクロールで見えなくなっても、片づけない）
  useEffect(() => {
    onPlayingChange?.(playing);
  }, [playing, onPlayingChange]);

  function togglePlay() {
    const audio = audioRef.current;
    if (!audio || !src || status !== "ready") return;
    if (playing) {
      audio.pause();
      setPlaying(false);
      return;
    }
    audio.currentTime = startRef.current;
    audio
      .play()
      .then(() => setPlaying(true))
      .catch(() => {});
  }

  return (
    <div ref={boxRef} className="relative w-full rounded-2xl overflow-hidden bg-[#0c0e12]" style={{ aspectRatio: "3 / 2" }}>
      <audio ref={audioRef} src={src || undefined} preload="none" onEnded={() => setPlaying(false)} />
      <canvas ref={canvasRef} className="absolute inset-0 block w-full h-full" />

      <span ref={clockRef} className="absolute bottom-2 left-3 text-[10px] font-mono text-white/70 tabular-nums">
        0:00 / {formatTime(durationSec)}
      </span>

      {status === "loading" && (
        <div className="absolute inset-0 flex items-center justify-center text-[11px] text-white/40">…</div>
      )}

      {status === "ready" && !playing && (
        <button onClick={togglePlay} aria-label="再生" className="absolute inset-0 flex items-center justify-center">
          <span className="w-14 h-14 rounded-full bg-white/25 backdrop-blur-sm flex items-center justify-center text-white text-xl">
            ▶
          </span>
        </button>
      )}
      {playing && <button onClick={togglePlay} aria-label="停止" className="absolute inset-0" />}
    </div>
  );
}
