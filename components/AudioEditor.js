"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { computeSpectrogram, drawSpectrogram } from "../lib/spectrogram";
import {
  renderFocused,
  focusGainDb,
  suggestBand,
  DEFAULT_FOCUS,
  steepFromPercent,
  percentFromSteep,
} from "../lib/audioFocus";
import { encodeWav } from "../lib/wav";

const MAX_FREQ_HZ = 13500; // スペクトログラムの上限（AudioSpectrogramCard と同じ）
const CANVAS_H = 300;
const MIN_DURATION = 0.3; // 選べる時間の最小（秒）
const MIN_BAND = 300; // 選べる周波数の幅の最小（Hz）
const MIN_ANALYZE_SEC = 1; // BirdNET が解析できる最小の長さ（これより短いと、再解析できない）

const cardClass = "bg-white border-[3px] border-cardBorder rounded-2xl p-4";
const inputClass =
  "w-full px-2 py-1.5 rounded-lg border-2 border-cardBorder bg-white text-sm text-ink outline-none focus:border-accent";
const btnClass =
  "rounded-full border-2 border-cardBorder bg-page px-3.5 py-1.5 text-[11px] font-bold text-[#3F6C74] hover:border-accent disabled:opacity-40";

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

const HL = "#FFD54A"; // 触れている部分・操作中の部分の強調色（黄色）

// 大きさを変えるために、つかめる点（角4つ＋辺の中央4つ）
function handleList(x0, y0, x1, y1) {
  const xm = (x0 + x1) / 2;
  const ym = (y0 + y1) / 2;
  return [
    { hx: "l", hy: "t", x: x0, y: y0 },
    { hx: "r", hy: "t", x: x1, y: y0 },
    { hx: "l", hy: "b", x: x0, y: y1 },
    { hx: "r", hy: "b", x: x1, y: y1 },
    { hx: null, hy: "t", x: xm, y: y0 },
    { hx: null, hy: "b", x: xm, y: y1 },
    { hx: "l", hy: null, x: x0, y: ym },
    { hx: "r", hy: null, x: x1, y: ym },
  ];
}

// 範囲が小さいときは、点が重なって見づらく・つかみにくくなるため、角だけにする（辺の中央の点は、十分な大きさのときだけ）
function visibleHandles(x0, y0, x1, y1) {
  const w = x1 - x0;
  const h = y1 - y0;
  return handleList(x0, y0, x1, y1).filter((p) => {
    if (p.hx && p.hy) return true;
    if (!p.hx) return w >= 90; // 上・下の辺の中央
    return h >= 70; // 左・右の辺の中央
  });
}

// マウスを乗せたときの、カーソルの形
function cursorFor(h) {
  if (!h) return "crosshair";
  if (h.type === "move") return "move";
  if (h.hx && h.hy) return (h.hx === "l") === (h.hy === "t") ? "nwse-resize" : "nesw-resize";
  return h.hx ? "ew-resize" : "ns-resize";
}

// 画面の下に出す、「いま何が起きるか」の説明
function hintFor(h) {
  if (!h) return "空いている所をドラッグ：新しい範囲を作る";
  if (h.type === "create") return "新しい範囲を作っています";
  if (h.type === "move") return "範囲の中をドラッグ：範囲ごと移動（大きさは変わりません）";
  if (h.hx && h.hy) return "角の点をドラッグ：時間と周波数の両方の範囲を変える";
  if (h.hx) return h.hx === "l" ? "左の辺をドラッグ：開始の時刻を変える" : "右の辺をドラッグ：終了の時刻を変える";
  return h.hy === "t" ? "上の辺をドラッグ：周波数の上限を変える" : "下の辺をドラッグ：周波数の下限を変える";
}

// 角丸の四角（古い iPhone の Safari には、標準の roundRect が無いため、自前で描く）
function roundedRect(g, x, y, w, h, r) {
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

// スライダーの、選んだ所までの色
function sliderBackground(value, min, max) {
  const pct = ((value - min) / (max - min)) * 100;
  return `linear-gradient(to right, #8FC2CB ${pct}%, #E9E6E1 ${pct}%)`;
}

function drawMoveIcon(g, cx, cy, r, on) {
  g.fillStyle = "rgba(20,30,35,0.8)";
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = on ? HL : "#ffffff";
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(cx - r * 0.62, cy);
  g.lineTo(cx + r * 0.62, cy);
  g.moveTo(cx, cy - r * 0.62);
  g.lineTo(cx, cy + r * 0.62);
  g.stroke();
  for (const angle of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    g.save();
    g.translate(cx, cy);
    g.rotate(angle);
    g.beginPath();
    g.moveTo(r * 0.4, -r * 0.24);
    g.lineTo(r * 0.66, 0);
    g.lineTo(r * 0.4, r * 0.24);
    g.stroke();
    g.restore();
  }
}

function drawHandles(g, x0, y0, x1, y1, hl, coarse) {
  // 範囲が小さいほど、点も小さくする（細い範囲が、点で埋まらないように）
  const k = (coarse ? 1.5 : 1) * Math.max(0.6, Math.min(1, Math.min(x1 - x0, y1 - y0) / 44));
  for (const h of visibleHandles(x0, y0, x1, y1)) {
    const on = !!hl && hl.type === "resize" && hl.handle && hl.hx === h.hx && hl.hy === h.hy;
    g.fillStyle = on ? HL : "#ffffff";
    g.strokeStyle = on ? "#7a5a00" : "#3F6C74";
    g.lineWidth = 2;
    g.beginPath();
    if (h.hx && h.hy) {
      g.arc(h.x, h.y, 6.5 * k, 0, Math.PI * 2);
    } else {
      const horizontal = !h.hx; // 上下の辺の中央
      const w = (horizontal ? 24 : 9) * k;
      const hgt = (horizontal ? 9 : 24) * k;
      roundedRect(g, h.x - w / 2, h.y - hgt / 2, w, hgt, 4);
    }
    g.fill();
    g.stroke();
  }
}

// 🔥 音声の編集（フォーカス）画面の中身。スペクトログラムで範囲（時間×周波数）を選び、外側の音を下げて、聞き比べる。
//    ・src（URL）か file（選んだファイル）から読み込む
//    ・initialRange：{ start, end }（秒）… 最初に選んでおく時間の範囲（鳥の詳細の「編集する」から来たとき）
//    ・範囲は、いくつでも作れる（抽出1、抽出2 …）
export default function AudioEditor({ src = null, file = null, initialRange = null }) {
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [errorMsg, setErrorMsg] = useState(null);
  const [duration, setDuration] = useState(0);
  const [topHz, setTopHz] = useState(MAX_FREQ_HZ);
  const [width, setWidth] = useState(0);
  const [selections, setSelections] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [normalize, setNormalize] = useState(true);
  const [loop, setLoop] = useState(false);
  const [playing, setPlaying] = useState(null); // { kind, id }
  const [busy, setBusy] = useState(false);
  const [playError, setPlayError] = useState(null);
  const [hover, setHover] = useState(null); // マウスを乗せている部分 { id, type, hx, hy, handle }
  const [drag, setDrag] = useState(null); // 操作中の部分 { id, type, hx, hy, handle }
  const [coarse, setCoarse] = useState(false); // 指で操作する端末（点を大きくする）
  const hoverKeyRef = useRef("");

  const audioRef = useRef(null); // { samples, sampleRate, duration }
  const framesRef = useRef(null);
  const wrapRef = useRef(null);
  const specRef = useRef(null);
  const overlayRef = useRef(null);
  const graphRef = useRef(null);
  const audioElRef = useRef(null); // 再生用の <audio>（iPhone の消音スイッチの影響を受けない）
  const blobUrlRef = useRef(null); // 加工した音（WAV）の、いまの URL
  const silentUrlRef = useRef(null); // 「押した瞬間に、再生を始めておく」ための、無音の WAV の URL
  const playRef = useRef(null);
  const rafRef = useRef(null);
  const cacheRef = useRef(new Map());
  const dragRef = useRef(null);
  const nextIdRef = useRef(1);

  const active = selections.find((s) => s.id === activeId) ?? null;

  useEffect(() => {
    setCoarse(window.matchMedia?.("(pointer: coarse)").matches ?? false);
  }, []);

  // ---------- 読み込み ----------
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setStatus("loading");
      setErrorMsg(null);
      setSelections([]);
      setActiveId(null);
      cacheRef.current.clear();
      try {
        let arrayBuffer;
        if (file) {
          arrayBuffer = await file.arrayBuffer();
        } else if (src) {
          const res = await fetch(src);
          if (!res.ok) throw new Error(`音声を取得できませんでした（${res.status}）`);
          arrayBuffer = await res.arrayBuffer();
        } else {
          throw new Error("音声が指定されていません");
        }
        // 読み込み（デコード）だけに使う。本物の AudioContext を作ると、iPhone で、音の出方（消音スイッチ）に影響するため、使わない
        const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
        const decoder = new Offline(1, 1, 48000);
        const buf = await new Promise((resolve, reject) => decoder.decodeAudioData(arrayBuffer.slice(0), resolve, reject));
        // モノラルにする（複数チャンネルは平均）
        const mono = new Float32Array(buf.length);
        for (let c = 0; c < buf.numberOfChannels; c++) {
          const ch = buf.getChannelData(c);
          for (let i = 0; i < ch.length; i++) mono[i] += ch[i] / buf.numberOfChannels;
        }
        const hop = Math.max(128, Math.ceil(buf.length / 1600));
        const { frames, topHz: top } = computeSpectrogram(mono, {
          fftSize: 2048,
          hop,
          bins: 128,
          sampleRate: buf.sampleRate,
          maxFreqHz: MAX_FREQ_HZ,
        });
        if (cancelled) return;
        audioRef.current = { samples: mono, sampleRate: buf.sampleRate, duration: buf.duration };
        framesRef.current = frames;
        setTopHz(top);
        setDuration(buf.duration);
        if (initialRange && initialRange.end > initialRange.start) {
          const t0 = clamp(initialRange.start, 0, buf.duration - MIN_DURATION);
          const t1 = clamp(initialRange.end, t0 + MIN_DURATION, buf.duration);
          const band = suggestBand(frames, top, buf.duration, t0, t1);
          const id = nextIdRef.current++;
          setSelections([{ id, t0, t1, ...band, ...DEFAULT_FOCUS }]);
          setActiveId(id);
        }
        setStatus("ready");
      } catch (err) {
        console.error(err);
        if (!cancelled) {
          setErrorMsg(err?.message ?? String(err));
          setStatus("error");
        }
      }
    }
    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, file]);

  // 後片付け（再生を止める）
  useEffect(
    () => () => {
      cancelAnimationFrame(rafRef.current);
      audioElRef.current?.pause();
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
      if (silentUrlRef.current) URL.revokeObjectURL(silentUrlRef.current);
    },
    []
  );

  // ---------- 表示の大きさ ----------
  useEffect(() => {
    if (!wrapRef.current) return;
    const observer = new ResizeObserver(() => setWidth(Math.round(wrapRef.current.getBoundingClientRect().width)));
    observer.observe(wrapRef.current);
    setWidth(Math.round(wrapRef.current.getBoundingClientRect().width));
    return () => observer.disconnect();
  }, [status]);

  const dpr = typeof window === "undefined" ? 1 : Math.min(2, window.devicePixelRatio || 1);
  const toX = useCallback((t) => (duration > 0 ? (t / duration) * width : 0), [duration, width]);
  const toY = useCallback((f) => CANVAS_H - (f / topHz) * CANVAS_H, [topHz]);
  const fromX = useCallback((x) => clamp((x / Math.max(1, width)) * duration, 0, duration), [duration, width]);
  const fromY = useCallback((y) => clamp(((CANVAS_H - y) / CANVAS_H) * topHz, 0, topHz), [topHz]);

  // スペクトログラム本体（1回描けばよい）
  useEffect(() => {
    if (status !== "ready" || !specRef.current || width === 0) return;
    const c = specRef.current;
    c.width = Math.round(width * dpr);
    c.height = Math.round(CANVAS_H * dpr);
    drawSpectrogram(c, framesRef.current, { nyquist: topHz, showLabels: true });
  }, [status, width, topHz, dpr]);

  // 選んだ範囲・再生位置（何度でも描き直す）
  const drawOverlay = useCallback(() => {
    const c = overlayRef.current;
    if (!c || width === 0) return;
    if (c.width !== Math.round(width * dpr)) {
      c.width = Math.round(width * dpr);
      c.height = Math.round(CANVAS_H * dpr);
    }
    const g = c.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, width, CANVAS_H);

    for (const s of selections) {
      const x0 = toX(s.t0);
      const x1 = toX(s.t1);
      const y0 = toY(s.fHi);
      const y1 = toY(s.fLo);
      const isActive = s.id === activeId;
      g.fillStyle = isActive ? "rgba(143,194,203,0.28)" : "rgba(143,194,203,0.14)";
      g.fillRect(x0, y0, x1 - x0, y1 - y0);
      g.strokeStyle = isActive ? "#B8E6EE" : "rgba(184,230,238,0.6)";
      g.lineWidth = isActive ? 2 : 1;
      g.strokeRect(x0, y0, x1 - x0, y1 - y0);
      g.fillStyle = "#B8E6EE";
      g.font = "bold 11px sans-serif";
      g.fillText(String(s.id), x0 + 4, y0 + 13);
      const hl = drag && drag.id === s.id ? drag : hover && hover.id === s.id ? hover : null;
      if (hl && hl.type === "move") {
        // 範囲ごと移動：範囲の全体を、黄色の点線で強調する
        g.strokeStyle = HL;
        g.lineWidth = 3;
        g.setLineDash([7, 4]);
        g.strokeRect(x0, y0, x1 - x0, y1 - y0);
        g.setLineDash([]);
      }
      if (hl && hl.type === "resize" && !hl.handle) {
        // 辺の線をつかむとき：その辺を、黄色で強調する
        g.strokeStyle = HL;
        g.lineWidth = 4;
        g.beginPath();
        if (hl.hx) {
          const x = hl.hx === "l" ? x0 : x1;
          g.moveTo(x, y0);
          g.lineTo(x, y1);
        }
        if (hl.hy) {
          const y = hl.hy === "t" ? y0 : y1;
          g.moveTo(x0, y);
          g.lineTo(x1, y);
        }
        g.stroke();
      }
      if (isActive) {
        drawHandles(g, x0, y0, x1, y1, hl, coarse);
        if (x1 - x0 >= 56 && y1 - y0 >= 46) {
          drawMoveIcon(g, (x0 + x1) / 2, (y0 + y1) / 2, coarse ? 17 : 13, !!hl && hl.type === "move");
        }
      }
      if (drag && drag.id === s.id) {
        // 操作中は、いまの値を、範囲のそばに出す
        const label = `${s.t0.toFixed(2)}〜${s.t1.toFixed(2)}秒（${(s.t1 - s.t0).toFixed(2)}秒）／${(s.fLo / 1000).toFixed(1)}〜${(s.fHi / 1000).toFixed(1)}kHz`;
        g.font = "bold 11px sans-serif";
        const w = g.measureText(label).width + 12;
        const lx = clamp(x0, 2, Math.max(2, width - w - 2));
        const ly = y0 > 26 ? y0 - 24 : Math.min(CANVAS_H - 22, y1 + 4);
        g.fillStyle = "rgba(20,30,35,0.88)";
        g.fillRect(lx, ly, w, 20);
        g.fillStyle = HL;
        g.fillText(label, lx + 6, ly + 14);
      }
    }

    // 再生位置
    const p = playRef.current;
    const el = audioElRef.current;
    if (p && el) {
      const x = toX(p.t0 + el.currentTime);
      g.strokeStyle = "#8FC2CB";
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, CANVAS_H);
      g.stroke();
    }
  }, [selections, activeId, width, dpr, toX, toY, hover, drag, coarse]);

  useEffect(() => {
    drawOverlay();
  }, [drawOverlay, status, playing]);

  // 下げ方のグラフ（横：周波数、縦：下げ幅）
  useEffect(() => {
    const c = graphRef.current;
    if (!c || !active) return;
    const w = c.clientWidth || 300;
    const h = 90;
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
    const g = c.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = "#faf9f7";
    g.fillRect(0, 0, w, h);
    const maxDb = 120;
    const band = { fLo: active.fLo, fHi: active.fHi, topHz };
    g.fillStyle = "rgba(143,194,203,0.25)";
    g.fillRect((active.fLo / topHz) * w, 0, ((active.fHi - active.fLo) / topHz) * w, h);
    g.strokeStyle = "#3F6C74";
    g.lineWidth = 2;
    g.beginPath();
    for (let x = 0; x <= w; x += 2) {
      const f = (x / w) * topHz;
      const db = Math.max(-maxDb, focusGainDb(f, band, active));
      const y = 6 + (-db / maxDb) * (h - 12);
      if (x === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
    if (active.floorDb != null) {
      // 「少し残す」の下限
      const yf = 6 + (-active.floorDb / maxDb) * (h - 12);
      g.strokeStyle = "rgba(224,138,60,0.9)";
      g.lineWidth = 1;
      g.setLineDash([4, 3]);
      g.beginPath();
      g.moveTo(0, yf);
      g.lineTo(w, yf);
      g.stroke();
      g.setLineDash([]);
    }
    g.fillStyle = "#8a857d";
    g.font = "10px sans-serif";
    g.fillText("0dB", 3, 12);
    g.fillText(`-${maxDb}dB`, 3, h - 3);
    g.fillText(`${topHz / 1000}kHz`, w - 38, h - 3);
  }, [active, topHz, dpr]);

  // ---------- 範囲の操作（マウス・指） ----------
  function pos(e) {
    const r = overlayRef.current.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  // 点（角・辺の中央）＞マウスのときだけ辺の細い線＞範囲の中（移動）の順で判定する。
  // 小さい範囲では、点の当たり判定を小さくして、中（移動できる所）を残す
  function hitTest(s, x, y, isTouch) {
    const x0 = toX(s.t0);
    const x1 = toX(s.t1);
    const y0 = toY(s.fHi);
    const y1 = toY(s.fLo);
    const w = x1 - x0;
    const h = y1 - y0;
    const R = Math.max(9, Math.min(isTouch ? 24 : 13, Math.min(w, h) / 3));
    let best = null;
    let bestDist = Infinity;
    for (const p of visibleHandles(x0, y0, x1, y1)) {
      const d = Math.hypot(x - p.x, y - p.y);
      if (d <= R && d < bestDist) {
        bestDist = d;
        best = { type: "resize", hx: p.hx, hy: p.hy, handle: true };
      }
    }
    if (best) return best;
    if (!isTouch) {
      const E = Math.max(3, Math.min(6, Math.min(w, h) / 4));
      if (x >= x0 - E && x <= x1 + E && y >= y0 - E && y <= y1 + E) {
        const hx = Math.abs(x - x0) <= E ? "l" : Math.abs(x - x1) <= E ? "r" : null;
        const hy = Math.abs(y - y0) <= E ? "t" : Math.abs(y - y1) <= E ? "b" : null;
        if (hx || hy) return { type: "resize", hx, hy, handle: false };
      }
    }
    if (x >= x0 && x <= x1 && y >= y0 && y <= y1) return { type: "move" };
    return null;
  }

  // 選んでいるものを優先し、次に、上に重なっている順
  function orderedSelections() {
    return [...selections].reverse().sort((a, b) => (a.id === activeId ? -1 : b.id === activeId ? 1 : 0));
  }

  function updateSelection(id, patch) {
    setSelections((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
    cacheRef.current.clear();
  }

  function onPointerDown(e) {
    if (status !== "ready") return;
    e.preventDefault();
    overlayRef.current.setPointerCapture(e.pointerId);
    const { x, y } = pos(e);
    const isTouch = e.pointerType !== "mouse";
    for (const s of orderedSelections()) {
      const h = hitTest(s, x, y, isTouch);
      if (h) {
        setActiveId(s.id);
        dragRef.current = { ...h, id: s.id, startX: x, startY: y, orig: { ...s } };
        setDrag({ id: s.id, ...h });
        setHover(null);
        return;
      }
    }
    dragRef.current = { type: "create", id: null, startX: x, startY: y };
    setDrag({ id: null, type: "create" });
  }

  function onPointerMove(e) {
    const d = dragRef.current;
    if (!d) {
      // 操作していないとき（マウスだけ）：乗せている部分を強調し、カーソルの形を変える
      if (e.pointerType !== "mouse" || status !== "ready") return;
      const { x, y } = pos(e);
      let found = null;
      for (const s of orderedSelections()) {
        const h = hitTest(s, x, y, false);
        if (h) {
          found = { id: s.id, ...h };
          break;
        }
      }
      const key = found ? `${found.id}|${found.type}|${found.hx}|${found.hy}|${found.handle}` : "";
      if (key !== hoverKeyRef.current) {
        hoverKeyRef.current = key;
        setHover(found);
      }
      overlayRef.current.style.cursor = cursorFor(found);
      return;
    }
    const { x, y } = pos(e);
    if (d.type === "create") {
      if (!d.id) {
        if (Math.hypot(x - d.startX, y - d.startY) < 6) return; // ただのタップは、範囲を作らない
        const id = nextIdRef.current++;
        d.id = id;
        setDrag({ id, type: "create" });
        setSelections((prev) => [
          ...prev,
          { id, t0: 0, t1: MIN_DURATION, fLo: 0, fHi: MIN_BAND, ...DEFAULT_FOCUS },
        ]);
        setActiveId(id);
      }
      const t0 = fromX(Math.min(d.startX, x));
      const t1 = Math.max(fromX(Math.max(d.startX, x)), Math.min(duration, t0 + MIN_DURATION));
      const fLo = fromY(Math.max(d.startY, y));
      const fHi = Math.max(fromY(Math.min(d.startY, y)), Math.min(topHz, fLo + MIN_BAND));
      updateSelection(d.id, { t0: Math.min(t0, duration - MIN_DURATION), t1, fLo, fHi });
      return;
    }
    const o = d.orig;
    if (d.type === "move") {
      const dt = fromX(x) - fromX(d.startX);
      const df = fromY(y) - fromY(d.startY);
      const len = o.t1 - o.t0;
      const bw = o.fHi - o.fLo;
      const t0 = clamp(o.t0 + dt, 0, duration - len);
      const fLo = clamp(o.fLo + df, 0, topHz - bw);
      updateSelection(d.id, { t0, t1: t0 + len, fLo, fHi: fLo + bw });
    } else {
      const patch = {};
      if (d.hx === "l") patch.t0 = clamp(fromX(x), 0, o.t1 - MIN_DURATION);
      if (d.hx === "r") patch.t1 = clamp(fromX(x), o.t0 + MIN_DURATION, duration);
      if (d.hy === "t") patch.fHi = clamp(fromY(y), o.fLo + MIN_BAND, topHz);
      if (d.hy === "b") patch.fLo = clamp(fromY(y), 0, o.fHi - MIN_BAND);
      updateSelection(d.id, patch);
    }
  }

  function onPointerUp() {
    const d = dragRef.current;
    if (d && d.type === "create" && !d.id) setActiveId(null); // 何もない所をタップ＝選択を外す
    dragRef.current = null;
    setDrag(null);
  }

  function onPointerLeave() {
    if (dragRef.current) return;
    hoverKeyRef.current = "";
    setHover(null);
  }

  // ---------- 再生 ----------
  function getFocused(s) {
    const a = audioRef.current;
    const key = JSON.stringify([s.t0, s.t1, s.fLo, s.fHi, s.mode, s.strengthDb, s.curve, s.octaveDb, normalize]);
    let y = cacheRef.current.get(key);
    if (!y) {
      y = renderFocused(a.samples, a.sampleRate, { t0: s.t0, t1: s.t1, fLo: s.fLo, fHi: s.fHi, topHz }, s, { normalize });
      if (cacheRef.current.size > 16) cacheRef.current.clear();
      cacheRef.current.set(key, y);
    }
    return y;
  }

  function stopPlayback() {
    playRef.current = null;
    cancelAnimationFrame(rafRef.current);
    audioElRef.current?.pause();
    setPlaying(null);
  }

  function tick() {
    drawOverlay();
    rafRef.current = requestAnimationFrame(tick);
  }

  // 🔥 加工した音を WAV にして、<audio> で再生する（Web Audio ではなく）。
  //    Web Audio は、iPhone の消音スイッチで無音になる／押した後に時間がかかると鳴らないことがある。
  //    <audio> は、他の再生（録音のカード）と同じように鳴る。
  //    iPhone は、「押した瞬間」に再生を始めないと、その後の再生を許さないため、
  //    押した瞬間に、無音のごく短い音を再生しておき、加工が終わってから、本物の音に差し替える
  async function play(kind, s) {
    const el = audioElRef.current;
    const a = audioRef.current;
    if (!el || !a) return;
    stopPlayback();
    setPlayError(null);
    if (!silentUrlRef.current) silentUrlRef.current = URL.createObjectURL(encodeWav(new Float32Array(64), 8000));
    el.loop = false;
    el.src = silentUrlRef.current;
    el.play().catch(() => {}); // 押した瞬間に始める（この後、音を差し替えるので、途中で止まる失敗は、無視してよい）

    setBusy(true);
    await new Promise((r) => setTimeout(r, 20)); // 「加工中」の表示を先に出す
    let samples;
    let t0 = 0;
    if (kind === "full") {
      samples = a.samples;
    } else if (kind === "original") {
      samples = a.samples.subarray(Math.floor(s.t0 * a.sampleRate), Math.ceil(s.t1 * a.sampleRate));
      t0 = s.t0;
    } else {
      samples = getFocused(s);
      t0 = s.t0;
    }
    setBusy(false);
    if (samples.length === 0) return;

    const url = URL.createObjectURL(encodeWav(samples, a.sampleRate));
    const previous = blobUrlRef.current;
    blobUrlRef.current = url;
    el.src = url;
    el.loop = loop && kind !== "full";
    el.currentTime = 0;
    try {
      await el.play();
    } catch (err) {
      console.error(err);
      setPlayError("再生できませんでした。もう一度、ボタンを押してみてください。（音量や、マナーモードも確認してください）");
      return;
    } finally {
      if (previous) URL.revokeObjectURL(previous);
    }
    playRef.current = { kind, t0, loop: el.loop };
    setPlaying({ kind, id: s?.id ?? null });
    rafRef.current = requestAnimationFrame(tick);
  }

  function removeSelection(id) {
    stopPlayback();
    setSelections((prev) => prev.filter((s) => s.id !== id));
    if (activeId === id) setActiveId(null);
    cacheRef.current.clear();
  }

  function suggestForActive() {
    if (!active) return;
    updateSelection(active.id, suggestBand(framesRef.current, topHz, duration, active.t0, active.t1));
  }

  const num = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
  // 「範囲の外を消す強さ」（0〜100%）。steep が無い（古い設定）ときは、標準の強さにする
  const steepPct = active ? percentFromSteep(active.steep > 0 ? active.steep : DEFAULT_FOCUS.steep) : 0;

  return (
    <div className="flex flex-col gap-3">
      <audio ref={audioElRef} playsInline preload="auto" className="hidden" onEnded={() => playRef.current && stopPlayback()} />
      <div className={cardClass}>
        <div className="text-[11px] text-inkMuted leading-relaxed mb-2">
          スペクトログラム（横＝時間、縦＝周波数）を<b>ドラッグして、範囲を選びます</b>。範囲の中の音を残し、外側の周波数は、遠いほど大きく下げます。範囲は、いくつでも作れます。
        </div>

        {status === "loading" && <div className="text-center text-xs text-inkMuted py-16">読み込み中...</div>}
        {status === "error" && <div className="text-center text-xs text-red-500 py-10 px-4">{errorMsg}</div>}

        <div
          ref={wrapRef}
          className="relative rounded-xl overflow-hidden border-[3px] border-cardBorder bg-black"
          style={{ height: CANVAS_H, display: status === "ready" ? "block" : "none" }}
        >
          <canvas ref={specRef} style={{ width: "100%", height: CANVAS_H, display: "block" }} />
          <canvas
            ref={overlayRef}
            style={{ position: "absolute", left: 0, top: 0, width: "100%", height: CANVAS_H, touchAction: "none", cursor: "crosshair" }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onPointerLeave={onPointerLeave}
            onLostPointerCapture={onPointerUp}
          />
        </div>

        {status === "ready" && (
          <div className="mt-1.5">
            <div className="text-[11px] font-bold text-ink min-h-[1.4rem] leading-snug">
              {(drag ? "操作中：" : "") + hintFor(drag ?? hover)}
            </div>
            <div className="text-[10px] text-inkMuted leading-relaxed">
              白い点（角・辺の中央）をドラッグ＝大きさを変える／範囲の中（✥）をドラッグ＝範囲ごと移動／空いた所をドラッグ＝新しい範囲
            </div>
          </div>
        )}

        {status === "ready" && (
          <div className="mt-2 flex items-center gap-2 flex-wrap">
            <button onClick={() => (playing?.kind === "full" ? stopPlayback() : play("full", null))} className={btnClass}>
              {playing?.kind === "full" ? "■ 停止" : "▶ 全体を再生"}
            </button>
            <span className="text-[10px] text-inkMuted">
              長さ {duration.toFixed(1)}秒{audioRef.current ? `・${(audioRef.current.sampleRate / 1000).toFixed(0)}kHz` : ""}
            </span>
          </div>
        )}
      </div>

      {status === "ready" && selections.length > 0 && (
        <div className={cardClass}>
          <div className="text-xs font-bold text-ink mb-2">抽出する範囲（{selections.length}件）</div>
          <div className="flex flex-wrap gap-1.5">
            {selections.map((s) => (
              <button
                key={s.id}
                onClick={() => setActiveId(s.id)}
                className={`rounded-full border-2 px-3 py-1 text-[11px] font-bold ${
                  s.id === activeId ? "border-accentText bg-white text-ink" : "border-cardBorder bg-page text-inkMuted"
                }`}
              >
                抽出{s.id}
              </button>
            ))}
          </div>
        </div>
      )}

      {status === "ready" && active && (
        <div className={cardClass}>
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs font-bold text-ink">抽出{active.id}</div>
            <button onClick={() => removeSelection(active.id)} className="text-[11px] font-bold text-red-500 underline underline-offset-2">
              この範囲を消す
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2 text-[10px] font-bold text-inkMuted">
            <label>
              開始（秒）
              <input
                type="number"
                step="0.05"
                min="0"
                value={active.t0.toFixed(2)}
                onChange={(e) => updateSelection(active.id, { t0: clamp(num(e.target.value, active.t0), 0, active.t1 - MIN_DURATION) })}
                className={`${inputClass} mt-1`}
              />
            </label>
            <label>
              終了（秒）
              <input
                type="number"
                step="0.05"
                min="0"
                value={active.t1.toFixed(2)}
                onChange={(e) => updateSelection(active.id, { t1: clamp(num(e.target.value, active.t1), active.t0 + MIN_DURATION, duration) })}
                className={`${inputClass} mt-1`}
              />
            </label>
            <label>
              周波数の下限（kHz）
              <input
                type="number"
                step="0.1"
                min="0"
                value={(active.fLo / 1000).toFixed(1)}
                onChange={(e) => updateSelection(active.id, { fLo: clamp(num(e.target.value, active.fLo / 1000) * 1000, 0, active.fHi - MIN_BAND) })}
                className={`${inputClass} mt-1`}
              />
            </label>
            <label>
              周波数の上限（kHz）
              <input
                type="number"
                step="0.1"
                min="0"
                value={(active.fHi / 1000).toFixed(1)}
                onChange={(e) => updateSelection(active.id, { fHi: clamp(num(e.target.value, active.fHi / 1000) * 1000, active.fLo + MIN_BAND, topHz) })}
                className={`${inputClass} mt-1`}
              />
            </label>
          </div>
          <div className="mt-2 flex items-center gap-2 flex-wrap">
            <button onClick={suggestForActive} className={btnClass}>
              周波数を自動で提案
            </button>
            <span className={`text-[10px] ${active.t1 - active.t0 < MIN_ANALYZE_SEC ? "text-red-500" : "text-inkMuted"}`}>
              長さ {(active.t1 - active.t0).toFixed(2)}秒
              {active.t1 - active.t0 < MIN_ANALYZE_SEC && "（再解析には1秒以上が必要です）"}
            </span>
          </div>

          <div className="mt-4 flex items-center gap-2 flex-wrap">
            <button onClick={() => (playing?.kind === "focused" && playing.id === active.id ? stopPlayback() : play("focused", active))} className={`${btnClass} !bg-[#3F6C74] !text-white !border-[#3F6C74]`}>
              {playing?.kind === "focused" && playing.id === active.id ? "■ 停止" : "▶ フォーカス後を聞く"}
            </button>
            <button onClick={() => (playing?.kind === "original" && playing.id === active.id ? stopPlayback() : play("original", active))} className={btnClass}>
              {playing?.kind === "original" && playing.id === active.id ? "■ 停止" : "▶ 元の音（この時間だけ）"}
            </button>
            <label className="flex items-center gap-1 text-[11px] text-ink">
              <input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} />
              くり返す
            </label>
            {busy && <span className="text-[11px] text-inkMuted">加工中…</span>}
          </div>
          {playError && <p className="mt-2 text-[11px] text-red-500 leading-relaxed">{playError}</p>}

          <div className="mt-4 text-[11px] font-bold text-ink">範囲の外の音の消し方</div>
          <canvas ref={graphRef} style={{ width: "100%", height: 90 }} className="mt-1 rounded-lg border-2 border-cardBorder" />
          <div className="text-[10px] text-inkMuted mt-1 leading-relaxed">
            横＝周波数（水色の帯が、残す範囲）／縦＝音の大きさの変化（線が下がるほど、小さく聞こえる。オレンジの点線＝「少し残す」の下限）。標準は、範囲の外を、ほぼ無くします。
          </div>

          <label className="mt-3 block text-[10px] font-bold text-inkMuted">
            下げ方の基準
            <select
              value={active.mode}
              onChange={(e) => updateSelection(active.id, { mode: e.target.value })}
              className={`${inputClass} mt-1`}
            >
              <option value="ratio">範囲の割合（標準）</option>
              <option value="octave">オクターブごと</option>
            </select>
          </label>

          {active.mode === "ratio" ? (
            <>
              <label className="mt-3 block text-[11px] text-ink">
                範囲の外を消す強さ：<b>{steepPct}%</b>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value={steepPct}
                  onChange={(e) => updateSelection(active.id, { steep: steepFromPercent(Number(e.target.value)) })}
                  className="abl-slider w-full mt-1 h-1 rounded-full appearance-none cursor-pointer"
                  style={{ background: sliderBackground(steepPct, 0, 100) }}
                />
                <span className="text-[10px] text-inkMuted">
                  右へ動かすほど、範囲のすぐ外から、一気に小さくなります（グラフの線が、崖のように落ちます）。標準は80%。左へ動かすと、なだらかになります
                </span>
              </label>
              <details className="mt-3">
                <summary className="text-[10px] font-bold text-inkMuted cursor-pointer">詳しい設定</summary>
                <label className="mt-2 block text-[11px] text-ink">
                  一番遠くの音を下げる量の上限：<b>{Math.min(active.strengthDb, 120)}dB</b>
                  <input
                    type="range"
                    min="20"
                    max="120"
                    step="5"
                    value={Math.min(active.strengthDb, 120)}
                    onChange={(e) => updateSelection(active.id, { strengthDb: Number(e.target.value) })}
                    className="abl-slider w-full mt-1 h-1 rounded-full appearance-none cursor-pointer"
                    style={{ background: sliderBackground(Math.min(active.strengthDb, 120), 20, 120) }}
                  />
                </label>
              </details>
            </>
          ) : (
            <label className="mt-3 block text-[11px] text-ink">
              境目の急さ：1オクターブ離れるごとに <b>{active.octaveDb}dB</b> 下げる
              <input
                type="range"
                min="12"
                max="240"
                step="12"
                value={active.octaveDb}
                onChange={(e) => updateSelection(active.id, { octaveDb: Number(e.target.value) })}
                className="abl-slider w-full mt-1 h-1 rounded-full appearance-none cursor-pointer"
                style={{ background: sliderBackground(active.octaveDb, 12, 240) }}
              />
              <span className="text-[10px] text-inkMuted">大きいほど、範囲の外が、すぐ無くなります（96：範囲の1オクターブ外で、ほぼ無音）</span>
            </label>
          )}

          <label className="mt-3 block text-[11px] text-ink">
            範囲の外を少し残す：<b>{active.floorDb == null ? "無し" : `${active.floorDb}dB`}</b>
            <input
              type="range"
              min="0"
              max="12"
              step="1"
              value={active.floorDb == null ? 0 : Math.round((65 + active.floorDb) / 5)}
              onChange={(e) => {
                const pos = Number(e.target.value);
                updateSelection(active.id, { floorDb: pos === 0 ? null : -(65 - 5 * pos) });
              }}
              className="abl-slider w-full mt-1 h-1 rounded-full appearance-none cursor-pointer"
              style={{ background: sliderBackground(active.floorDb == null ? 0 : Math.round((65 + active.floorDb) / 5), 0, 12) }}
            />
            <span className="text-[10px] text-inkMuted">
              標準は「無し」（範囲の外を、完全に消します）。周りの音も、少し混ぜたいときだけ、右へ動かします（右ほど、多く残ります）
            </span>
          </label>

          <label className="mt-3 flex items-center gap-2 text-[11px] text-ink">
            <input
              type="checkbox"
              checked={normalize}
              onChange={(e) => {
                setNormalize(e.target.checked);
                cacheRef.current.clear();
              }}
            />
            加工した音の音量を揃える（小さい音を、聞こえる大きさにする）
          </label>

          <p className="mt-3 text-[10px] text-inkMuted leading-relaxed">
            ※ いまは、聞いて調整するところまでです。保存と、加工した音の書き出し（再解析）は、次の段階で追加します。
          </p>
        </div>
      )}
    </div>
  );
}
