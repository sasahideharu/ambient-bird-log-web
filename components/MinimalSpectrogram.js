"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { computeSpectrogram, drawSpectrogram } from "../lib/spectrogram";

// 🔥 ミニマルトップページ用の、大きく強調したスペクトログラム。
//    再生ボタンはスペクトログラムの上に半透明で重ね、再生中はボタンを消して
//    再生位置を示すラインだけが動く
export default function MinimalSpectrogram({ src, startSec, endSec }) {
  const audioRef = useRef(null);
  const canvasRef = useRef(null);
  const rafRef = useRef(null);
  const framesRef = useRef(null);
  const nyquistRef = useRef(null);

  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [playing, setPlaying] = useState(false);

  const redraw = useCallback((playheadT) => {
    if (!framesRef.current || !canvasRef.current) return;
    drawSpectrogram(canvasRef.current, framesRef.current, {
      nyquist: nyquistRef.current,
      playheadT,
      showLabels: false,
    });
  }, []);

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
      redraw(0);
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
    <div
      className="relative w-full rounded-2xl overflow-hidden bg-[#150603]"
      style={{ aspectRatio: "3 / 2" }}
    >
      <audio
        ref={audioRef}
        src={src || undefined}
        preload="none"
        onEnded={() => {
          setPlaying(false);
          redraw(0);
        }}
      />
      <canvas ref={canvasRef} width={700} height={467} className="w-full h-full block" />

      {status === "ready" && !playing && (
        <button
          onClick={togglePlay}
          aria-label="再生"
          className="absolute inset-0 flex items-center justify-center"
        >
          <span className="w-14 h-14 rounded-full bg-white/25 backdrop-blur-sm flex items-center justify-center text-white text-xl">
            ▶
          </span>
        </button>
      )}
      {playing && (
        <button
          onClick={togglePlay}
          aria-label="停止"
          className="absolute inset-0"
        />
      )}
    </div>
  );
}
