"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { computeSpectrogram, drawSpectrogram } from "../lib/spectrogram";

// 🔥 音声再生・スペクトログラム表示・再生位置と連動したプレイヘッド・タップで拡大表示をまとめたカード
export default function AudioSpectrogramCard({ src, startSec, endSec }) {
  const audioRef = useRef(null);
  const canvasRef = useRef(null);
  const modalCanvasRef = useRef(null);
  const rafRef = useRef(null);
  const framesRef = useRef(null);
  const nyquistRef = useRef(null);

  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [playing, setPlaying] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const redraw = useCallback(
    (playheadT) => {
      if (!framesRef.current) return;
      if (canvasRef.current) {
        drawSpectrogram(canvasRef.current, framesRef.current, {
          nyquist: nyquistRef.current,
          playheadT,
          showLabels: false,
        });
      }
      if (expanded && modalCanvasRef.current) {
        drawSpectrogram(modalCanvasRef.current, framesRef.current, {
          nyquist: nyquistRef.current,
          playheadT,
          showLabels: true,
        });
      }
    },
    [expanded]
  );

  useEffect(() => {
    let cancelled = false;
    if (!src) {
      setStatus("error");
      return;
    }
    async function run() {
      try {
        setStatus("loading");
        const res = await fetch(src);
        const arrayBuffer = await res.arrayBuffer();
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        const ctx = new AudioCtx();
        const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
        const sampleRate = audioBuffer.sampleRate;
        const channel = audioBuffer.getChannelData(0);
        const s = Math.max(0, Math.floor((startSec ?? 0) * sampleRate));
        const e = Math.min(
          channel.length,
          Math.floor((endSec ?? audioBuffer.duration) * sampleRate)
        );
        const slice = channel.slice(s, e);
        const { frames, topHz } = computeSpectrogram(slice, {
          fftSize: 2048,
          hop: 96,
          bins: 160,
          sampleRate,
          maxFreqHz: 13500,
        });
        ctx.close();
        if (cancelled) return;

        framesRef.current = frames;
        nyquistRef.current = topHz;
        setStatus("ready");
        requestAnimationFrame(() => redraw(0));
      } catch (err) {
        console.error(err);
        if (!cancelled) setStatus("error");
      }
    }
    run();
    return () => {
      cancelled = true;
      cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, startSec, endSec]);

  // 拡大表示を開いたタイミングで、その時点の状態をすぐ描き直す
  useEffect(() => {
    if (expanded) redraw(playing ? currentPlayheadT() : 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded]);

  function currentPlayheadT() {
    const audio = audioRef.current;
    if (!audio) return 0;
    const dur = (endSec ?? 0) - (startSec ?? 0);
    return dur > 0 ? (audio.currentTime - (startSec ?? 0)) / dur : 0;
  }

  function loop() {
    const audio = audioRef.current;
    if (!audio) return;
    if (endSec != null && audio.currentTime >= endSec) {
      audio.pause();
      audio.currentTime = startSec ?? 0;
      setPlaying(false);
      redraw(0);
      return;
    }
    redraw(currentPlayheadT());
    rafRef.current = requestAnimationFrame(loop);
  }

  function togglePlay() {
    const audio = audioRef.current;
    if (!audio || !src || status !== "ready") return;

    if (playing) {
      audio.pause();
      cancelAnimationFrame(rafRef.current);
      setPlaying(false);
      return;
    }

    audio.currentTime = startSec ?? 0;
    audio
      .play()
      .then(() => {
        setPlaying(true);
        rafRef.current = requestAnimationFrame(loop);
      })
      .catch(() => {});
  }

  return (
    <div>
      <audio
        ref={audioRef}
        src={src || undefined}
        preload="none"
        onEnded={() => setPlaying(false)}
      />
      <div className="flex gap-2 items-center">
        <button
          onClick={togglePlay}
          disabled={!src || status !== "ready"}
          aria-label={playing ? "停止" : "再生"}
          className="w-9 h-9 rounded-full bg-[#E8AEB8] flex items-center justify-center text-white text-sm flex-shrink-0 shadow-[0_3px_0_#C97F8D] disabled:opacity-40"
        >
          {status === "loading" ? "…" : playing ? "❚❚" : "▶"}
        </button>
        <button
          onClick={() => setExpanded(true)}
          disabled={status !== "ready"}
          aria-label="スペクトログラムを拡大表示"
          className="flex-1 rounded-lg overflow-hidden bg-[#150603]"
          style={{ height: 60 }}
        >
          {status === "error" ? (
            <span className="text-[10px] text-[#9C978F]">読み込み失敗</span>
          ) : (
            <canvas
              ref={canvasRef}
              width={440}
              height={120}
              style={{ width: "100%", height: "100%", display: "block" }}
            />
          )}
        </button>
      </div>

      {expanded && (
        <div
          className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-6"
          onClick={() => setExpanded(false)}
        >
          <div
            className="bg-white rounded-2xl p-4 max-w-sm w-full"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center mb-3">
              <div className="text-xs font-bold text-ink">スペクトログラム</div>
              <button onClick={() => setExpanded(false)} className="text-inkMuted text-lg leading-none">
                ✕
              </button>
            </div>
            <canvas
              ref={modalCanvasRef}
              width={900}
              height={460}
              style={{ width: "100%", height: "auto", borderRadius: 8, display: "block" }}
            />
            <div className="flex justify-center mt-3">
              <button
                onClick={togglePlay}
                className="w-10 h-10 rounded-full bg-[#E8AEB8] flex items-center justify-center text-white shadow-[0_3px_0_#C97F8D]"
              >
                {playing ? "❚❚" : "▶"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
