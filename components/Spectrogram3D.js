"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createViewer } from "../lib/spectrogram3d";
import { loadSpectrogram, loadPcm } from "../lib/spectrogram3dData"; // 録音を読み込んで、左右のスペクトログラムにする（「大きく見る」の元の画面と共通）
import { createScrubPlayer, scrubSupported } from "../lib/scrubPlayer"; // 再生位置のスライダーを手でずらしたとき、レコードのように鳴らす

const VIEW_BUTTONS = [
  { id: "iso", label: "ななめ" },
  { id: "front", label: "正面（左右×周波数）" },
  { id: "side", label: "横（時間×周波数）" },
  { id: "top", label: "上（左右×時間）" },
];

const RATE_MIN = 0.05; // 再生の速さ（1＝ふつう）の、いちばん遅い値
const RATE_MAX = 1;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

const btn = "rounded-lg border border-[#2a313b] bg-[#1f252d] px-3 py-1.5 text-[12px] text-[#e8edf3] hover:border-[#4aa3ff] disabled:opacity-40";
const btnOn = "!border-[#4aa3ff] !bg-[#173049]";
const titleCls = "block text-[11px] text-[#93a0b0] mb-1";
const valCls = "text-[#4aa3ff] tabular-nums";

// 🔥 3D スペクトログラム：縦＝周波数、横＝左右（音が大きいほど幅広く）、奥＝時間。再生ボタン・再生位置の線つき。
//    はじめは3D（ななめ）。「2Dで見る」ボタンで、横（時間×周波数）の2D表示になる。2D表示で再生すると、視点が「横」から「ななめ」へ、ゆっくり変わる（聞き終わりは「ななめ」）。手で回すと止まる。
//    描き方は、線（初期）／面／面＋線。
//    再生：「▶ 再生」（順）と「◀ 逆再生」（逆）。速さは、スライダーで、0.05倍〜1倍（遅くするほど、音は低くなる＝レコードの回転を遅くしたのと同じ）。
//      順の1倍だけ、ふつうの再生（audio）。ほかは、AudioWorklet のプレーヤー（lib/scrubPlayer.js）で鳴らす。
//    再生位置のスライダーを、指でずらすと、レコードのように、ずらす速さ・向きで、音が鳴る（戻すと、逆再生。止めると、無音）。
//      ずらし終わったとき、ずらす前に再生中だったなら、そこから（同じ向きで）再生を続ける。
//    src：録音の URL／startSec・endSec：見る範囲（秒。無ければ全体）／title：上に出す名前／onClose：閉じる
export default function Spectrogram3D({ src, startSec = null, endSec = null, title = "", onClose }) {
  const stageRef = useRef(null);
  const hudRef = useRef(null);
  const canvasRef = useRef(null);
  const audioRef = useRef(null);
  const seekRef = useRef(null);
  const clockRef = useRef(null);
  const viewerRef = useRef(null);
  const dataRef = useRef(null);
  const endedRef = useRef(false);
  const lastUiRef = useRef(0);
  const rangeStartRef = useRef(0);
  const loopRef = useRef(false);
  const headShownRef = useRef(false); // 再生位置の線を、いま出しているか
  const scrubRef = useRef(null); // ずらして聞くためのプレーヤー
  const scrubbingRef = useRef(false); // いま、スライダーを手でずらしているか
  const resumeAfterScrubRef = useRef(null); // ずらす前に再生中だったときの、向き（"fwd"｜"rev"）。ずらし終わったら、続ける
  const engineRef = useRef(null); // いま音を鳴らしているもの：null（止まっている）｜"html"（ふつうの再生）｜"worklet"（逆再生・遅い再生）
  const dirRef = useRef("fwd"); // 再生の向き
  const rateRef = useRef(1); // 再生の速さ（画面の状態の写し。コールバックから読む用）
  const workletEndedRef = useRef(null); // 逆再生・遅い再生が、端まで来たときの処理

  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [errorMsg, setErrorMsg] = useState(null);
  const [info, setInfo] = useState(null); // { duration, channels }
  const [playing, setPlaying] = useState(false);
  const [playError, setPlayError] = useState(null);
  const [activeView, setActiveView] = useState("iso"); // 初期：ななめ（3D）。"side"（横）＝2D表示
  const [panelOpen, setPanelOpen] = useState(true);
  // 設定（初期値）
  const [widthScale, setWidthScale] = useState(0.65);
  const [floor, setFloor] = useState(0.12);
  const [smooth, setSmooth] = useState(0);
  const [colorMode, setColorMode] = useState("inferno"); // 音の強さ（黄＝強い）
  const [midDark, setMidDark] = useState(0); // 0＝もとの色
  const [grid, setGrid] = useState(true);
  const [autoRotate, setAutoRotate] = useState(false);
  const [drawMode, setDrawMode] = useState("lines"); // 線（初期）／面／面＋線
  const [lineCount, setLineCount] = useState(80);
  const [thick, setThick] = useState(2); // 線の太さ 1〜4（初期：ふつう）
  const [loop, setLoop] = useState(false);
  const [rate, setRate] = useState(1); // 再生の速さ（0.05〜1）
  const [direction, setDirection] = useState("fwd"); // 再生の向き："fwd"（順）｜"rev"（逆）
  const [pcmReady, setPcmReady] = useState(false); // 逆再生・遅い再生に使う音（サンプル）を、読み込めたか
  const [maxHz, setMaxHz] = useState(10000);
  const [autoHz, setAutoHz] = useState(10000);
  const [hzIsAuto, setHzIsAuto] = useState(true);

  // 設定をまとめて、描画へ渡す
  const settingsRef = useRef({});
  settingsRef.current = { widthScale, floor, smooth, colorMode, midDark, grid, auto: autoRotate, maxHz, drawMode, lineCount, thick };
  loopRef.current = loop;
  rateRef.current = rate;
  const activeViewRef = useRef("iso");
  activeViewRef.current = activeView;

  // ---------- 描画の準備（画面ができたとき／閉じるとき） ----------
  useEffect(() => {
    if (window.innerWidth < 640) setPanelOpen(false); // スマホの縦画面では、設定は、はじめは閉じておく（3D を大きく見せる）
    const canvas = canvasRef.current;
    let viewer;
    try {
      viewer = createViewer({
        canvas,
        onUserRotate: () => setActiveView(null),
        onFrame: () => {
          const audio = audioRef.current;
          const d = dataRef.current;
          const v = viewerRef.current;
          if (!audio || !d || !v) return;
          const start = rangeStartRef.current;
          // 再生位置の線は、再生中だけ出す（止まっているときは、出さない）
          const scrubbing = scrubbingRef.current; // 手でずらしている間は、スライダーの位置が、再生位置（audio は止めてある）
          const engine = engineRef.current;
          const playingNow = scrubbing || engine === "worklet" || (!audio.paused && !audio.ended);
          if (playingNow !== headShownRef.current) {
            headShownRef.current = playingNow;
            v.setPlayheadVisible(playingNow);
          }
          if (playingNow && !scrubbing && engine === "worklet") {
            // 逆再生・遅い再生：プレーヤーの位置が、再生位置
            const player = scrubRef.current;
            if (player?.stats.ended) {
              workletEndedRef.current?.();
              return;
            }
            const t = player ? player.getPos() : 0;
            v.setPlayhead(t);
            v.updateSweep(t / d.duration);
            showTime(t, d.duration);
          } else if (playingNow && !scrubbing) {
            // 指定した範囲の終わりまで来たら、止める（くり返しがオンなら、最初へ）
            if (audio.currentTime >= start + d.duration - 0.02) {
              if (loopRef.current) {
                audio.currentTime = start;
                v.endSweep(); // 視点の移動は、1回目だけ（そのあとは「ななめ」のまま）
                setActiveView("iso");
              } else {
                audio.pause();
                endedRef.current = true;
                v.setPlayhead(d.duration);
                setPlaying(false);
                if (v.isSweeping()) {
                  v.endSweep(); // 聞き終わったら、「ななめ」の視点になっている
                  setActiveView("iso");
                }
                showTime(d.duration, d.duration);
                return;
              }
            }
            const t = Math.max(0, audio.currentTime - start);
            v.setPlayhead(t);
            v.updateSweep(t / d.duration);
            showTime(t, d.duration);
          }
        },
      });
    } catch (err) {
      console.error(err);
      setErrorMsg("この端末（ブラウザ）では、3D表示を使えません（WebGL が使えません）");
      setStatus("error");
      return;
    }
    viewerRef.current = viewer;

    const stage = stageRef.current;
    const doResize = () => viewer.resize(stage.clientWidth, stage.clientHeight, (hudRef.current?.offsetHeight ?? 0) + 8);
    const ro = new ResizeObserver(doResize);
    ro.observe(stage);
    if (hudRef.current) ro.observe(hudRef.current);
    doResize();

    return () => {
      ro.disconnect();
      viewer.dispose();
      viewerRef.current = null;
      audioRef.current?.pause();
    };
  }, []);

  // ずらして聞くためのプレーヤー（AudioWorklet が使えない環境では、作らない）。閉じるときに、片づける
  useEffect(() => {
    if (!scrubSupported()) return;
    const player = createScrubPlayer();
    scrubRef.current = player;
    return () => {
      scrubbingRef.current = false;
      player.dispose();
      scrubRef.current = null;
    };
  }, []);

  // 再生位置の数字とスライダー（毎フレーム、画面全体を描き直さないよう、直接書き換える）
  function showTime(t, duration) {
    const now = performance.now();
    if (now - lastUiRef.current < 60 && t < duration) return;
    lastUiRef.current = now;
    if (seekRef.current) seekRef.current.value = t;
    if (clockRef.current) clockRef.current.textContent = `${t.toFixed(1)} / ${duration.toFixed(1)}秒`;
  }

  // ---------- 録音を読み込む ----------
  useEffect(() => {
    let cancelled = false;
    if (!src) {
      setErrorMsg("録音が指定されていません");
      setStatus("error");
      return;
    }
    setStatus("loading");
    setErrorMsg(null);
    setPcmReady(false);
    loadSpectrogram(src, startSec, endSec)
      .then((data) => {
        if (cancelled || !viewerRef.current) return;
        dataRef.current = data;
        rangeStartRef.current = Math.max(0, startSec ?? 0);
        const s = settingsRef.current;
        viewerRef.current.set({ ...s, maxHz: s.maxHz });
        const hz = viewerRef.current.setData(data); // 周波数の上限は、録音から自動で計算
        setAutoHz(hz);
        setMaxHz(hz);
        setHzIsAuto(true);
        viewerRef.current.set({ ...settingsRef.current, maxHz: hz });
        setInfo({ duration: data.duration, channels: data.channels });
        endedRef.current = false;
        setStatus("ready");
        showTime(0, data.duration);
        if (audioRef.current) audioRef.current.currentTime = rangeStartRef.current;
        // ずらして聞くための音（左右のサンプル）。読み込めなくても、ほかの機能は、そのまま使える
        loadPcm(src, startSec, endSec)
          .then(({ channels, sampleRate }) => {
            if (cancelled || !scrubRef.current) return;
            scrubRef.current.load(channels, sampleRate);
            setPcmReady(true);
          })
          .catch((err) => console.warn("ずらして聞くための音を、読み込めませんでした", err));
      })
      .catch((err) => {
        console.error(err);
        if (!cancelled) {
          setErrorMsg(err?.message ?? "読み込めませんでした");
          setStatus("error");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [src, startSec, endSec]);

  // 設定を変えたら、描画へ渡す
  useEffect(() => {
    viewerRef.current?.set({ widthScale, floor, smooth, colorMode, midDark, grid, auto: autoRotate, maxHz, drawMode, lineCount, thick });
  }, [widthScale, floor, smooth, colorMode, midDark, grid, autoRotate, maxHz, drawMode, lineCount, thick]);

  // ---------- 再生（順・逆・速さ） ----------
  const isPlayingNow = () => {
    const audio = audioRef.current;
    return engineRef.current === "worklet" || (!!audio && !audio.paused && !audio.ended);
  };
  const signedRate = () => (dirRef.current === "rev" ? -rateRef.current : rateRef.current);

  // 止める（いまの位置を、audio とスライダーに、合わせておく）
  const stopPlayback = useCallback(() => {
    const audio = audioRef.current;
    const d = dataRef.current;
    const player = scrubRef.current;
    if (engineRef.current === "worklet") {
      const t = player ? player.getPos() : 0;
      player?.stop();
      if (audio && d) audio.currentTime = rangeStartRef.current + t;
      if (d) showTime(t, d.duration);
    } else {
      audio?.pause();
    }
    engineRef.current = null;
    setPlaying(false);
  }, []);

  // 始める。dir："fwd"（順）｜"rev"（逆）。いま動いているものがあれば、その位置から、向きを変えて続ける
  const startPlayback = useCallback(async (dir) => {
    const audio = audioRef.current;
    const d = dataRef.current;
    const v = viewerRef.current;
    const player = scrubRef.current;
    if (!audio || !d || !v) return;
    const start = rangeStartRef.current;
    let t;
    if (engineRef.current === "worklet") {
      t = player ? player.getPos() : 0;
      player?.stop();
    } else {
      t = audio.currentTime - start;
      audio.pause();
    }
    engineRef.current = null;
    // 端にいるときは、反対の端から
    if (dir === "fwd" ? endedRef.current || t >= d.duration - 0.05 || t < -0.01 : t <= 0.05) t = dir === "fwd" ? 0 : d.duration;
    t = clamp(t, 0, d.duration);
    const r = rateRef.current;
    const useWorklet = dir === "rev" || r < 0.999; // 順の1倍だけ、ふつうの再生
    setPlayError(null);
    if (useWorklet && player && player.isLoaded()) {
      let ok = false;
      try {
        ok = await player.play(t, dir === "rev" ? -r : r);
      } catch (err) {
        console.error(err);
      }
      if (!ok) {
        setPlayError("再生できませんでした。もう一度、ボタンを押してみてください。");
        return;
      }
      engineRef.current = "worklet";
    } else if (dir === "fwd") {
      // 予備：逆再生・遅い再生のプレーヤーが使えないときは、ふつうの再生の速さ変更で、鳴らす（音の高さは保たれる。0.0625倍より遅くは、できない）
      audio.currentTime = start + t;
      audio.playbackRate = useWorklet ? Math.max(0.0625, r) : 1;
      try {
        await audio.play();
      } catch (err) {
        console.error(err);
        setPlayError("再生できませんでした。もう一度、ボタンを押してみてください。（音量や、マナーモードも確認してください）");
        return;
      }
      engineRef.current = "html";
    } else {
      setPlayError("この端末では、逆再生は使えません。");
      return;
    }
    dirRef.current = dir;
    setDirection(dir);
    endedRef.current = false;
    setPlaying(true);
    if (activeViewRef.current === "side") {
      // 2D 表示（横）から再生したときは、視点が、「横」から「ななめ」へ、ゆっくり変わりはじめる
      v.startSweep(t / d.duration);
      setActiveView(null);
    }
  }, []);

  // 「▶ 再生」「◀ 逆再生」：同じ向きで動いていれば止める。違う向きなら、向きを変える
  const togglePlay = useCallback(
    (dir = "fwd") => {
      if (isPlayingNow() && dirRef.current === dir) stopPlayback();
      else startPlayback(dir);
    },
    [startPlayback, stopPlayback]
  );

  // 逆再生・遅い再生が、端まで来た
  workletEndedRef.current = () => {
    const d = dataRef.current;
    const v = viewerRef.current;
    const player = scrubRef.current;
    const audio = audioRef.current;
    if (!d || !v || !player) return;
    const dir = dirRef.current;
    if (loopRef.current) {
      // くり返し：反対の端から、続ける
      player.play(dir === "fwd" ? 0 : d.duration, signedRate()).catch((err) => console.error(err));
      if (dir === "fwd" && v.isSweeping()) {
        v.endSweep();
        setActiveView("iso");
      }
      return;
    }
    engineRef.current = null;
    player.stop();
    const t = dir === "fwd" ? d.duration : 0;
    if (audio) audio.currentTime = rangeStartRef.current + t;
    endedRef.current = dir === "fwd";
    v.setPlayhead(t);
    setPlaying(false);
    if (v.isSweeping()) {
      v.endSweep();
      setActiveView("iso");
    }
    showTime(t, d.duration);
  };

  // 速さを変える（0.05〜1倍）。再生中でも、すぐ変わる
  function changeRate(next) {
    const r = clamp(Math.round(next * 100) / 100, RATE_MIN, RATE_MAX);
    setRate(r);
    rateRef.current = r;
    const audio = audioRef.current;
    const player = scrubRef.current;
    if (engineRef.current === "worklet") {
      player?.setRate(dirRef.current === "rev" ? -r : r);
    } else if (engineRef.current === "html" && r < 0.999 && audio) {
      if (player?.isLoaded()) {
        // ふつうの再生から、遅い再生へ：同じ位置から、プレーヤーに引き継ぐ
        const t = audio.currentTime - rangeStartRef.current;
        audio.pause();
        engineRef.current = null;
        player
          .play(t, r)
          .then((ok) => {
            if (ok) engineRef.current = "worklet";
            else setPlaying(false);
          })
          .catch((err) => {
            console.error(err);
            setPlaying(false);
          });
      } else {
        audio.playbackRate = Math.max(0.0625, r); // 予備
      }
    }
  }

  useEffect(() => {
    const onKey = (e) => {
      if (e.code === "Space" && !["INPUT", "SELECT", "BUTTON", "TEXTAREA"].includes(e.target.tagName)) {
        e.preventDefault();
        togglePlay("fwd");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePlay]);

  function handleSeek(e) {
    const d = dataRef.current;
    if (!d) return;
    const t = Number(e.target.value);
    if (scrubbingRef.current) {
      scrubRef.current?.move(t); // ずらしている間は、音の位置が、この位置を追いかける（audio の位置は、ずらし終わったときに合わせる）
    } else if (audioRef.current) {
      audioRef.current.currentTime = rangeStartRef.current + t;
      if (engineRef.current === "worklet") scrubRef.current?.play(t, signedRate()).catch((err) => console.error(err)); // 逆再生・遅い再生の途中で動かした：その位置から
    }
    endedRef.current = t >= d.duration - 0.02;
    viewerRef.current?.setPlayhead(t);
    if (clockRef.current) clockRef.current.textContent = `${t.toFixed(1)} / ${d.duration.toFixed(1)}秒`;
  }

  // スライダーに触れた：再生中なら止めて、ずらして聞くモードに入る（指を離したら、終わる）
  function scrubStart() {
    const audio = audioRef.current;
    const d = dataRef.current;
    const v = viewerRef.current;
    if (!audio || !d || !v || scrubbingRef.current) return;
    scrubbingRef.current = true;
    resumeAfterScrubRef.current = isPlayingNow() ? dirRef.current : null; // 再生中だったら、その向きを覚えておく
    if (engineRef.current === "worklet") scrubRef.current?.stop();
    else audio.pause();
    engineRef.current = null;
    setPlaying(false);
    v.setPlayheadVisible(true);
    headShownRef.current = true;
    scrubRef.current?.start(Number(seekRef.current?.value ?? 0)).catch((err) => console.warn("ずらして聞く音を、始められませんでした", err));
    const end = () => {
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      scrubEnd();
    };
    window.addEventListener("pointerup", end); // 指がスライダーの外で離れても、終わるように
    window.addEventListener("pointercancel", end);
  }

  function scrubEnd() {
    if (!scrubbingRef.current) return;
    scrubbingRef.current = false;
    scrubRef.current?.stop();
    const audio = audioRef.current;
    const d = dataRef.current;
    if (!audio || !d) return;
    const t = Number(seekRef.current?.value ?? 0);
    audio.currentTime = rangeStartRef.current + t;
    endedRef.current = t >= d.duration - 0.02;
    const resume = resumeAfterScrubRef.current;
    resumeAfterScrubRef.current = null;
    if (resume && !(resume === "fwd" && endedRef.current) && !(resume === "rev" && t <= 0.05)) startPlayback(resume); // 同じ向きで、続ける
  }

  function pickView(id) {
    viewerRef.current?.setView(id);
    setActiveView(id);
  }

  const stereo = info?.channels === 2;
  const ready = status === "ready";

  return (
    <div
      className="fixed inset-0 z-[80] flex flex-col bg-[#0c0e12] text-[#e8edf3]"
      style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <audio ref={audioRef} src={src || undefined} preload="auto" />

      {/* 3D の画面 */}
      <div ref={stageRef} className="relative flex-1 min-h-[220px]">
        <canvas ref={canvasRef} className="absolute inset-0 block w-full h-full cursor-grab active:cursor-grabbing" style={{ touchAction: "none" }} />

        <div ref={hudRef} className="absolute left-3 top-2.5 right-[124px] pointer-events-none text-[12px] leading-relaxed [text-shadow:0_1px_3px_#000]">
          <b className="text-[14px] break-all">{title || "3D スペクトログラム"}</b>
          {ready && info && (
            <>
              <br />
              <span className="text-[#93a0b0]">
                長さ {info.duration.toFixed(1)}秒・{stereo ? "ステレオ" : "モノラル"}・縦＝周波数（〜{(maxHz / 1000).toFixed(1)}kHz）・横＝左右（大きいほど幅広く）・奥＝時間
              </span>
              {!stereo && (
                <>
                  <br />
                  <span className="text-[#ffd27a]">※ モノラルの録音なので、左右は同じ形（対称）です。左右の違いは、ステレオの録音で見えます。</span>
                </>
              )}
            </>
          )}
        </div>

        <div className="absolute right-2.5 top-2.5 z-[5] flex flex-col items-end gap-1.5">
          <div className="flex gap-1.5">
            <button onClick={() => setPanelOpen((v) => !v)} className={`${btn} !px-2.5`} aria-label="設定を開閉">
              ⚙ 設定
            </button>
            <button onClick={onClose} className={`${btn} !px-2.5`} aria-label="閉じる">
              ✕
            </button>
          </div>
          {/* 3D（ななめ）と 2D（横＝時間×周波数）の切り替え */}
          <button onClick={() => pickView(activeView === "side" ? "iso" : "side")} disabled={!ready} className={`${btn} !px-2.5 font-semibold`}>
            {activeView === "side" ? "3Dに戻す" : "2Dで見る"}
          </button>
        </div>

        {status === "loading" && (
          <div className="absolute inset-0 flex items-center justify-center text-[12px] text-[#93a0b0]">読み込み中…（音を解析しています）</div>
        )}
        {status === "error" && (
          <div className="absolute inset-0 flex items-center justify-center px-8 text-center text-[12px] text-[#F0B4AE] leading-relaxed">
            {errorMsg ?? "読み込めませんでした"}
          </div>
        )}
      </div>

      {/* 再生バー：1段目＝再生位置のスライダー（指でずらすと、レコードのように鳴る）・時間／2段目＝逆再生・再生・くり返す／3段目＝速さ（0.05〜1倍） */}
      <div className="border-t border-[#2a313b] bg-[#161a20] px-2.5 py-2">
        <div className="flex items-center gap-2">
          <input
            ref={seekRef}
            type="range"
            min="0"
            max={info ? info.duration.toFixed(2) : 1}
            step="0.01"
            defaultValue="0"
            onChange={handleSeek}
            onPointerDown={scrubStart}
            disabled={!ready}
            aria-label="再生位置（指でずらすと、ずらす速さ・向きで、音が鳴ります）"
            className="h-7 min-w-0 flex-1 accent-[#4aa3ff]"
          />
          <span ref={clockRef} className={`${valCls} whitespace-nowrap text-[11px]`}>
            0.0 / 0.0秒
          </span>
        </div>
        <div className="mt-1.5 flex items-center gap-1.5">
          <button
            onClick={() => togglePlay("rev")}
            disabled={!ready || !pcmReady}
            className={`${btn} min-w-[92px] !py-2 font-semibold ${playing && direction === "rev" ? btnOn : ""}`}
            title={pcmReady ? "" : "逆再生の準備中です（音を読み込んでいます）"}
          >
            {playing && direction === "rev" ? "■ 停止" : "◀ 逆再生"}
          </button>
          <button onClick={() => togglePlay("fwd")} disabled={!ready} className={`${btn} min-w-[92px] !py-2 font-semibold ${playing && direction === "fwd" ? btnOn : ""}`}>
            {playing && direction === "fwd" ? "■ 停止" : "▶ 再生"}
          </button>
          <button onClick={() => setLoop((v) => !v)} className={`${btn} ml-auto !px-2 !py-1.5 !text-[11px] ${loop ? btnOn : ""}`}>
            くり返す
          </button>
        </div>
        <div className="mt-1.5 flex items-center gap-2">
          <span className="whitespace-nowrap text-[11px] text-[#93a0b0]">速さ</span>
          <input
            type="range"
            min={RATE_MIN}
            max={RATE_MAX}
            step="0.01"
            value={rate}
            onChange={(e) => changeRate(Number(e.target.value))}
            disabled={!ready}
            aria-label="再生の速さ（0.05倍〜1倍）"
            className="h-6 min-w-0 flex-1 accent-[#4aa3ff]"
          />
          <span className={`${valCls} w-[48px] whitespace-nowrap text-right text-[12px]`}>×{rate.toFixed(2)}</span>
          <button onClick={() => changeRate(1)} disabled={!ready || rate === 1} className={`${btn} !px-2 !py-1 !text-[11px]`}>
            ×1
          </button>
        </div>
        {ready && scrubSupported() && (
          <p className="mt-1.5 text-[10px] leading-relaxed text-[#93a0b0]">
            遅くするほど、音は低くなります（レコードのように）。再生位置のバーを指でずらすと、ずらす速さ・向きで音が鳴ります（戻すと逆再生・止めると無音）。
          </p>
        )}
      </div>
      {playError && <p className="bg-[#161a20] px-3 pb-2 text-[11px] text-[#F0B4AE] leading-relaxed">{playError}</p>}

      {/* 設定 */}
      {panelOpen && (
        <div className="grid max-h-[46vh] grid-cols-2 gap-x-3 gap-y-2 overflow-y-auto border-t border-[#2a313b] bg-[#161a20] px-3 pb-3 pt-2.5 text-[12px] sm:grid-cols-3 lg:grid-cols-4">
          <div className="col-span-2 sm:col-span-3 lg:col-span-2">
            <span className={titleCls}>見る向き</span>
            <div className="flex flex-wrap gap-1.5">
              {VIEW_BUTTONS.map((b) => (
                <button key={b.id} onClick={() => pickView(b.id)} className={`${btn} ${activeView === b.id ? btnOn : ""}`}>
                  {b.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className={titleCls}>
              音の大きさ → 横のひろがり：<span className={valCls}>×{widthScale.toFixed(2)}</span>
            </label>
            <input type="range" min="0.3" max="1.6" step="0.05" value={widthScale} onChange={(e) => setWidthScale(Number(e.target.value))} className="w-full accent-[#4aa3ff]" />
          </div>
          <div>
            <label className={titleCls}>
              小さい音を隠す：<span className={valCls}>{floor.toFixed(2)}</span>
            </label>
            <input type="range" min="0" max="0.9" step="0.01" value={floor} onChange={(e) => setFloor(Number(e.target.value))} className="w-full accent-[#4aa3ff]" />
          </div>
          <div>
            <label className={titleCls}>
              なめらかさ：<span className={valCls}>{smooth === 0 ? "なし" : `${smooth}回`}</span>
            </label>
            <input type="range" min="0" max="4" step="1" value={smooth} onChange={(e) => setSmooth(Number(e.target.value))} className="w-full accent-[#4aa3ff]" />
          </div>
          <div>
            <label className={titleCls}>
              周波数の上限：<span className={valCls}>{(maxHz / 1000).toFixed(1)}kHz{hzIsAuto ? "（自動）" : ""}</span>
              <button
                onClick={() => {
                  setMaxHz(autoHz);
                  setHzIsAuto(true);
                }}
                className="ml-1.5 rounded-md border border-[#2a313b] bg-[#1f252d] px-2 text-[10px]"
              >
                自動
              </button>
            </label>
            <input
              type="range"
              min="3000"
              max="13500"
              step="500"
              value={maxHz}
              onChange={(e) => {
                setMaxHz(Number(e.target.value));
                setHzIsAuto(false);
              }}
              className="w-full accent-[#4aa3ff]"
            />
          </div>
          <div>
            <label className={titleCls}>
              中間の赤の暗さ（音の強さの色）：<span className={valCls}>{midDark === 0 ? "もとの色" : midDark >= 1 ? "黒に近い" : midDark.toFixed(2)}</span>
            </label>
            <input type="range" min="0" max="1" step="0.05" value={midDark} onChange={(e) => setMidDark(Number(e.target.value))} className="w-full accent-[#4aa3ff]" />
          </div>
          <div>
            <span className={titleCls}>描き方</span>
            <div className="flex flex-wrap gap-1.5">
              {[
                { id: "lines", label: "線" },
                { id: "surface", label: "面" },
                { id: "both", label: "面＋線" },
              ].map((m) => (
                <button key={m.id} onClick={() => setDrawMode(m.id)} className={`${btn} ${drawMode === m.id ? btnOn : ""}`}>
                  {m.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className={titleCls}>
              線の太さ：<span className={valCls}>{["", "細い", "ふつう", "太い", "とても太い"][thick]}</span>
            </label>
            <input type="range" min="1" max="4" step="1" value={thick} onChange={(e) => setThick(Number(e.target.value))} className="w-full accent-[#4aa3ff]" />
          </div>
          <div>
            <label className={titleCls}>
              線の本数：<span className={valCls}>{lineCount}本</span>
            </label>
            <input type="range" min="20" max="200" step="10" value={lineCount} onChange={(e) => setLineCount(Number(e.target.value))} className="w-full accent-[#4aa3ff]" />
          </div>
          <div>
            <span className={titleCls}>色</span>
            <div className="flex flex-wrap gap-1.5">
              <button onClick={() => setColorMode("lr")} className={`${btn} ${colorMode === "lr" ? btnOn : ""}`}>
                <span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm align-[-1px] bg-[#2b8cff]" />
                左＝青・右＝橙
              </button>
              <button onClick={() => setColorMode("inferno")} className={`${btn} ${colorMode === "inferno" ? btnOn : ""}`}>
                音の強さ（黄＝強い）
              </button>
            </div>
          </div>
          <div>
            <span className={titleCls}>動かす</span>
            <div className="flex flex-wrap gap-1.5">
              <button onClick={() => setAutoRotate((v) => !v)} className={`${btn} ${autoRotate ? btnOn : ""}`}>
                {autoRotate ? "まわしている（止める）" : "自動でまわす"}
              </button>
              <button onClick={() => setGrid((v) => !v)} className={`${btn} ${grid ? btnOn : ""}`}>
                グリッド線
              </button>
            </div>
            <p className="mt-1.5 text-[11px] leading-relaxed text-[#93a0b0]">
              ドラッグ：まわす／ホイール・ピンチ：拡大縮小
              <br />
              2D表示（横）で再生すると、視点が「横」から「ななめ」へ、ゆっくり変わります（手で回すと止まります）
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
