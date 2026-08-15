"use client";

import { useRef, useState } from "react";

// 🔥 実際の音声（mp3）を再生するボタン。start_sec〜end_secの区間だけ再生する
export default function PlayButton({ src, startSec, endSec }) {
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);

  function handleClick() {
    const audio = audioRef.current;
    if (!audio || !src) return;

    if (playing) {
      audio.pause();
      setPlaying(false);
      return;
    }

    setLoading(true);
    audio.currentTime = startSec ?? 0;
    audio
      .play()
      .then(() => {
        setPlaying(true);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }

  function handleTimeUpdate() {
    const audio = audioRef.current;
    if (!audio) return;
    if (endSec != null && audio.currentTime >= endSec) {
      audio.pause();
      audio.currentTime = startSec ?? 0;
      setPlaying(false);
    }
  }

  return (
    <>
      <audio
        ref={audioRef}
        src={src || undefined}
        preload="none"
        onTimeUpdate={handleTimeUpdate}
        onEnded={() => setPlaying(false)}
      />
      <button
        onClick={handleClick}
        disabled={!src}
        aria-label={playing ? "停止" : "再生"}
        className="w-9 h-9 rounded-full bg-accent flex items-center justify-center text-white text-sm flex-shrink-0 shadow-[0_3px_0_#5F9298] disabled:opacity-40"
      >
        {loading ? "…" : playing ? "❚❚" : "▶"}
      </button>
    </>
  );
}
