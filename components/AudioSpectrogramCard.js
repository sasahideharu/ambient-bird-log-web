"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import {
  computeSpectrogram,
  normalizeFrames,
  drawSpectrogram,
  drawStereoSpectrogram,
  STEREO_COLORS,
  channelIsOn,
  toggleChannel,
} from "../lib/spectrogram";

// ステレオの表示の切り替え（「左」「右」の2つのスイッチ。両方オン＝色分けして重ねる／片方だけ＝その片方だけ）。左＝青・右＝オレンジ
function ChannelChips({ view, onChange, showLegend = false }) {
  const chips = [
    { id: "L", label: "左", color: STEREO_COLORS.left },
    { id: "R", label: "右", color: STEREO_COLORS.right },
  ];
  return (
    <div className="flex items-center gap-1">
      {chips.map((c) => {
        const on = channelIsOn(view, c.id);
        const rgb = c.color.join(",");
        return (
          <button
            key={c.id}
            onClick={() => onChange(toggleChannel(view, c.id))}
            aria-pressed={on}
            aria-label={`${c.label}を表示${on ? "（オン）" : "（オフ）"}`}
            className="rounded-full border px-2.5 py-[1px] text-[10px] font-bold leading-4"
            style={
              on
                ? { borderColor: `rgb(${rgb})`, color: `rgb(${rgb})`, backgroundColor: `rgba(${rgb},0.12)` }
                : { borderColor: "#E9E6E1", color: "#9C978F", backgroundColor: "#F6F4F0" }
            }
          >
            {on ? "✓" : ""}
            {c.label}
          </button>
        );
      })}
      {showLegend && (
        <span className="ml-1 text-[9px] text-inkMuted">
          {view === "LR" ? "両方オン＝色分けして重ねる（白っぽい＝左右どちらにも出ている音）" : view === "L" ? "左だけを表示中" : "右だけを表示中"}
        </span>
      )}
    </div>
  );
}

// 🔥 音声再生・スペクトログラム表示・再生位置と連動したプレイヘッド・タップで拡大表示をまとめたカード
export default function AudioSpectrogramCard({ src, startSec, endSec }) {
  const audioRef = useRef(null);
  const canvasRef = useRef(null);
  const modalCanvasRef = useRef(null);
  const rafRef = useRef(null);
  const framesRef = useRef(null); // チャンネルごとのスペクトログラムの配列（モノラル＝1本、ステレオ＝2本）
  const nyquistRef = useRef(null);

  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [playing, setPlaying] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [view, setView] = useState("LR"); // ステレオの表示：LR＝左右を色分けして重ねる／L＝左だけ／R＝右だけ
  const [numChannels, setNumChannels] = useState(1);

  const paint = useCallback(
    (canvas, playheadT, showLabels) => {
      const chans = framesRef.current;
      if (!chans || !canvas) return;
      if (chans.length >= 2) {
        drawStereoSpectrogram(canvas, chans[0], chans[1], { view, nyquist: nyquistRef.current, playheadT, showLabels });
      } else {
        drawSpectrogram(canvas, chans[0], { nyquist: nyquistRef.current, playheadT, showLabels });
      }
    },
    [view]
  );

  const redraw = useCallback(
    (playheadT) => {
      if (!framesRef.current) return;
      paint(canvasRef.current, playheadT, false);
      if (expanded) paint(modalCanvasRef.current, playheadT, true);
    },
    [expanded, paint]
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
        const s = Math.max(0, Math.floor((startSec ?? 0) * sampleRate));
        const e = Math.min(
          audioBuffer.length,
          Math.floor((endSec ?? audioBuffer.duration) * sampleRate)
        );
        // 🔥 ステレオ（左右のマイクが離れている録音）は、左右それぞれのスペクトログラムを作り、色分けして重ねて表示する（左＝青・右＝オレンジ。
        //    左右を選んで、片方だけを見ることもできる）。左だけでは、右のマイクにだけ鳴いた鳥が見えず、左右を混ぜて1つにすると、
        //    位相のずれた音が打ち消し合って、鳥の声が弱く見えることがあるため。
        //    計算が増えすぎないよう、ステレオのときだけ、時間の細かさ（hop）を、画面の細かさに見合う程度まで粗くする（モノラルは、今までどおり）
        const chCount = audioBuffer.numberOfChannels;
        const hop = chCount > 1 ? Math.max(96, Math.ceil((e - s) / 1500)) : 96;
        const specs = [];
        for (let c = 0; c < Math.min(chCount, 2); c++) {
          specs.push(
            computeSpectrogram(audioBuffer.getChannelData(c).slice(s, e), {
              fftSize: 2048,
              hop,
              bins: 160,
              sampleRate,
              maxFreqHz: 13500,
            })
          );
        }
        const topHz = specs[0].topHz;
        // 左右に、共通の明るさの基準（大きい方の最大値）を使う＝左右の音量の差が、明るさの差として残る
        const sharedMaxDb = Math.max(...specs.map((sp) => sp.maxDb));
        const perChannel = specs.length > 1 ? specs.map((sp) => normalizeFrames(sp.rawFrames, sharedMaxDb)) : [specs[0].frames];
        ctx.close();
        if (cancelled) return;

        framesRef.current = perChannel;
        nyquistRef.current = topHz;
        setNumChannels(perChannel.length);
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

  // 拡大表示を開いたとき・左右の表示を切り替えたときに、その時点の状態をすぐ描き直す
  useEffect(() => {
    if (status === "ready") redraw(playing ? currentPlayheadT() : 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, view]);

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

      {numChannels >= 2 && status === "ready" && (
        <div className="mt-1 pl-11">
          <ChannelChips view={view} onChange={setView} />
        </div>
      )}

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
            {numChannels >= 2 && (
              <div className="mt-2">
                <ChannelChips view={view} onChange={setView} showLegend />
              </div>
            )}
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
