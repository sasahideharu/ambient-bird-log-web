"use client";

import { useEffect, useRef, useState } from "react";
import { computeSpectrogram, infernoColor } from "../lib/spectrogram";

// 🔥 実際の音声を取得・解析して、inferno風のスペクトログラムを描画する
export default function Spectrogram({ src, startSec, endSec, width = 120, height = 34 }) {
  const canvasRef = useRef(null);
  const [status, setStatus] = useState("loading"); // loading | ready | error

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
        const e = Math.min(channel.length, Math.floor((endSec ?? audioBuffer.duration) * sampleRate));
        const slice = channel.slice(s, e);

        const frames = computeSpectrogram(slice, { fftSize: 512, hop: 256, bins: 32 });

        if (cancelled) return;

        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.width = width;
        canvas.height = height;
        const g = canvas.getContext("2d");
        g.fillStyle = "#150603";
        g.fillRect(0, 0, width, height);

        const colW = width / Math.max(1, frames.length);
        const rowH = height / 32;
        frames.forEach((frame, fi) => {
          for (let b = 0; b < frame.length; b++) {
            const t = frame[b];
            if (t < 0.05) continue;
            g.fillStyle = infernoColor(t);
            const y = height - (b + 1) * rowH;
            g.fillRect(fi * colW, y, colW + 0.5, rowH + 0.5);
          }
        });

        ctx.close();
        setStatus("ready");
      } catch (err) {
        console.error(err);
        if (!cancelled) setStatus("error");
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [src, startSec, endSec, width, height]);

  return (
    <div
      style={{ width, height }}
      className="rounded-md flex-shrink-0 bg-[#150603] flex items-center justify-center overflow-hidden"
    >
      {status === "loading" && (
        <span className="text-[8px] text-[#9A9A8A]">解析中…</span>
      )}
      {status === "error" && <span className="text-[8px] text-[#9A9A8A]">読み込み失敗</span>}
      <canvas ref={canvasRef} style={{ display: status === "ready" ? "block" : "none" }} />
    </div>
  );
}
