"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createViewer } from "../lib/spectrogram3d";
import { loadSpectrogram } from "../lib/spectrogram3dData"; // 録音を読み込んで、左右のスペクトログラムにする（「大きく見る」の元の画面と共通）

const VIEW_BUTTONS = [
  { id: "iso", label: "ななめ" },
  { id: "front", label: "正面（左右×周波数）" },
  { id: "side", label: "横（時間×周波数）" },
  { id: "top", label: "上（左右×時間）" },
];

const btn = "rounded-lg border border-[#2a313b] bg-[#1f252d] px-3 py-1.5 text-[12px] text-[#e8edf3] hover:border-[#4aa3ff] disabled:opacity-40";
const btnOn = "!border-[#4aa3ff] !bg-[#173049]";
const titleCls = "block text-[11px] text-[#93a0b0] mb-1";
const valCls = "text-[#4aa3ff] tabular-nums";

// 🔥 3D スペクトログラム：縦＝周波数、横＝左右（音が大きいほど幅広く）、奥＝時間。再生ボタン・再生位置の線つき。
//    はじめは3D（ななめ）。「2Dで見る」ボタンで、横（時間×周波数）の2D表示になる。2D表示で再生すると、視点が「横」から「ななめ」へ、ゆっくり変わる（聞き終わりは「ななめ」）。手で回すと止まる。
//    描き方は、線（初期）／面／面＋線。
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
  const [maxHz, setMaxHz] = useState(10000);
  const [autoHz, setAutoHz] = useState(10000);
  const [hzIsAuto, setHzIsAuto] = useState(true);

  // 設定をまとめて、描画へ渡す
  const settingsRef = useRef({});
  settingsRef.current = { widthScale, floor, smooth, colorMode, midDark, grid, auto: autoRotate, maxHz, drawMode, lineCount, thick };
  loopRef.current = loop;
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
          const playingNow = !audio.paused && !audio.ended;
          if (playingNow !== headShownRef.current) {
            headShownRef.current = playingNow;
            v.setPlayheadVisible(playingNow);
          }
          if (playingNow) {
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

  // ---------- 再生 ----------
  const togglePlay = useCallback(async () => {
    const audio = audioRef.current;
    const d = dataRef.current;
    const v = viewerRef.current;
    if (!audio || !d || !v) return;
    if (!audio.paused && !audio.ended) {
      audio.pause();
      setPlaying(false);
      return;
    }
    const start = rangeStartRef.current;
    let t = audio.currentTime - start;
    if (endedRef.current || t >= d.duration - 0.05 || t < -0.01) {
      audio.currentTime = start;
      t = 0;
    }
    setPlayError(null);
    try {
      await audio.play();
    } catch (err) {
      console.error(err);
      setPlayError("再生できませんでした。もう一度、ボタンを押してみてください。（音量や、マナーモードも確認してください）");
      return;
    }
    endedRef.current = false;
    setPlaying(true);
    if (activeViewRef.current === "side") {
      // 2D 表示（横）から再生したときは、視点が、「横」から「ななめ」へ、ゆっくり変わりはじめる
      v.startSweep(t / d.duration);
      setActiveView(null);
    }
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.code === "Space" && !["INPUT", "SELECT", "BUTTON", "TEXTAREA"].includes(e.target.tagName)) {
        e.preventDefault();
        togglePlay();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePlay]);

  function handleSeek(e) {
    const d = dataRef.current;
    if (!d) return;
    const t = Number(e.target.value);
    if (audioRef.current) audioRef.current.currentTime = rangeStartRef.current + t;
    endedRef.current = t >= d.duration - 0.02;
    viewerRef.current?.setPlayhead(t);
    if (clockRef.current) clockRef.current.textContent = `${t.toFixed(1)} / ${d.duration.toFixed(1)}秒`;
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

      {/* 再生バー */}
      <div className="flex items-center gap-2 border-t border-[#2a313b] bg-[#161a20] px-2.5 py-2">
        <button onClick={togglePlay} disabled={!ready} className={`${btn} min-w-[78px] !py-2 font-semibold ${playing ? btnOn : ""}`}>
          {playing ? "■ 停止" : "▶ 再生"}
        </button>
        <input
          ref={seekRef}
          type="range"
          min="0"
          max={info ? info.duration.toFixed(2) : 1}
          step="0.01"
          defaultValue="0"
          onChange={handleSeek}
          disabled={!ready}
          aria-label="再生位置"
          className="flex-1 min-w-0 accent-[#4aa3ff]"
        />
        <span ref={clockRef} className={`${valCls} whitespace-nowrap text-[11px]`}>
          0.0 / 0.0秒
        </span>
        <button onClick={() => setLoop((v) => !v)} className={`${btn} !px-2 !py-1.5 !text-[11px] ${loop ? btnOn : ""}`}>
          くり返す
        </button>
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
