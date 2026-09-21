"use client";

import { useEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import BackLink from "./BackLink";
import { captureSupport, startPcmCapture } from "../lib/pcmCapture";
import { LiveSpectrogram } from "../lib/liveSpectrogram";

const card = "mx-4 mt-2.5 mb-3 bg-white border-[3px] border-cardBorder rounded-2xl p-4";
const btn = "w-full rounded-xl bg-[#3F6C74] text-white text-sm font-bold py-3 disabled:opacity-40";
const TONE = { ok: "text-[#3F6C74]", warn: "text-[#C2860A]", ng: "text-red-500", info: "text-inkMuted" };
const MARK = { ok: "✅", warn: "⚠️", ng: "❌", info: "・" };

function Row({ tone = "info", label, value }) {
  return (
    <div className={`flex gap-2 text-[11px] leading-relaxed ${TONE[tone]}`}>
      <span className="shrink-0">{MARK[tone]}</span>
      <span className="font-bold shrink-0">{label}</span>
      <span className="break-all">{value}</span>
    </div>
  );
}

const yesno = (v) => (v ? "使える" : "使えない");
const dbText = (v) => `${v.toFixed(1)} dBFS`;

// Int16 の音（バイト列）を、base64 にする（端末に書き込むため）
function bytesToBase64(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function toInt16(chunks) {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Int16Array(total);
  let pos = 0;
  for (const c of chunks) {
    for (let i = 0; i < c.length; i++) out[pos++] = Math.max(-32768, Math.min(32767, Math.round(c[i] * 32767)));
  }
  return out;
}

// 端末への書き込みの試験（アプリだけ）。1秒分ずつ、書き足していく（本番の録音と同じやり方）
async function writeTest(chunks, sampleRate) {
  if (!Capacitor.isNativePlatform()) return { skipped: "アプリではないので、試験しません" };
  const { Filesystem, Directory } = await import("@capacitor/filesystem");
  const pcm = toInt16(chunks);
  const bytes = new Uint8Array(pcm.buffer);
  const step = sampleRate * 2; // 1秒分
  const path = "diag/test.pcm";
  const t0 = performance.now();
  try {
    await Filesystem.mkdir({ path: "diag", directory: Directory.Data, recursive: true });
  } catch {
    // すでにある
  }
  for (let i = 0, first = true; i < bytes.length; i += step, first = false) {
    const data = bytesToBase64(bytes.subarray(i, i + step));
    if (first) await Filesystem.writeFile({ path, directory: Directory.Data, data });
    else await Filesystem.appendFile({ path, directory: Directory.Data, data });
  }
  const ms = performance.now() - t0;
  const stat = await Filesystem.stat({ path, directory: Directory.Data });
  await Filesystem.deleteFile({ path, directory: Directory.Data });
  return { bytesWritten: bytes.length, sizeOnDisk: stat.size, ms, seconds: bytes.length / step };
}

// 診断画面（録音機能の下見）。マイク・位置情報・画面を消したときの挙動を、この端末で確かめる
export default function RecordingDiag() {
  const [env, setEnv] = useState(null);
  const [busy, setBusy] = useState(null); // "mic" | "bg" | "geo" | null
  const [mic, setMic] = useState(null);
  const [bg, setBg] = useState(null);
  const [geo, setGeo] = useState(null);
  const [progress, setProgress] = useState(null);
  const [level, setLevel] = useState(null);
  const [copied, setCopied] = useState(false);
  const canvasRef = useRef(null);
  const levelRef = useRef({ rms: -120, peak: -120 });

  useEffect(() => {
    const nav = navigator;
    setEnv({
      platform: Capacitor.getPlatform(),
      native: Capacitor.isNativePlatform(),
      origin: location.origin,
      ua: nav.userAgent,
      support: captureSupport(),
      geolocation: !!nav.geolocation,
      wakeLock: "wakeLock" in nav,
      online: nav.onLine,
      cores: nav.hardwareConcurrency ?? null,
      memoryGb: nav.deviceMemory ?? null,
      screen: `${screen.width}×${screen.height}（倍率 ${window.devicePixelRatio}）`,
    });
  }, []);

  // 録音して、様子を測る。seconds 秒間。画面を消す試験（watchVisibility）では、画面の表示・非表示も記録する
  async function capture(seconds, { watchVisibility = false, useWakeLock = false, save = false }) {
    let spec = null;
    let cap = null;
    const chunks = [];
    let lastWall = 0;
    let maxGapMs = 0;
    const gaps = [];
    let sumSq = 0;
    let count = 0;
    let peak = 0;
    const visLog = [];
    let startedAt = 0;
    let wake = null;
    let wakeResult = null;

    const onVis = () => visLog.push({ atSec: Math.round((performance.now() - startedAt) / 100) / 10, state: document.visibilityState });
    if (watchVisibility) document.addEventListener("visibilitychange", onVis);
    if (useWakeLock) {
      try {
        wake = await navigator.wakeLock.request("screen");
        wakeResult = "取得できた";
      } catch (err) {
        wakeResult = `取得できなかった（${err?.name ?? err}）`;
      }
    }

    let raf = 0;
    try {
      cap = await startPcmCapture({
        onChunk: (chunk, info) => {
          chunks.push(chunk);
          const gap = info.wallMs - lastWall;
          lastWall = info.wallMs;
          if (gap > 250) gaps.push({ atSec: Math.round(info.wallMs / 100) / 10, gapSec: Math.round(gap / 100) / 10 });
          if (gap > maxGapMs) maxGapMs = gap;
          for (let i = 0; i < chunk.length; i++) {
            const v = chunk[i];
            sumSq += v * v;
            const a = Math.abs(v);
            if (a > peak) peak = a;
          }
          count += chunk.length;
          if (!spec && cap) spec = new LiveSpectrogram({ sampleRate: cap.sampleRate });
          if (spec) spec.push(chunk);
          levelRef.current = { rms: 20 * Math.log10(Math.sqrt(sumSq / count) + 1e-9), peak: 20 * Math.log10(peak + 1e-9) };
        },
      });
      startedAt = performance.now();
      const loop = () => {
        if (spec && canvasRef.current) spec.draw(canvasRef.current);
        setProgress(Math.min(seconds, Math.round((performance.now() - startedAt) / 100) / 10));
        setLevel({ ...levelRef.current });
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
      await new Promise((r) => setTimeout(r, seconds * 1000));
    } finally {
      cancelAnimationFrame(raf);
      if (watchVisibility) document.removeEventListener("visibilitychange", onVis);
      if (wake) wake.release().catch(() => {});
    }
    const trackStateEnd = cap?.trackState?.();
    await cap?.stop();

    const wallSec = lastWall / 1000;
    const expected = wallSec * cap.sampleRate;
    const result = {
      seconds,
      mode: cap.mode,
      sampleRate: cap.sampleRate,
      settings: cap.settings,
      asked: cap.constraintsAsked,
      label: cap.trackLabel,
      samples: count,
      ratio: expected > 0 ? count / expected : 0,
      maxGapMs,
      gaps,
      rmsDb: 20 * Math.log10(Math.sqrt(sumSq / (count || 1)) + 1e-9),
      peakDb: 20 * Math.log10(peak + 1e-9),
      visLog,
      wakeResult,
      trackStateEnd,
    };
    if (save) {
      try {
        result.write = await writeTest(chunks, cap.sampleRate);
      } catch (err) {
        result.write = { error: err?.message ?? String(err) };
      }
    }
    return result;
  }

  async function runMic() {
    setBusy("mic");
    setMic(null);
    try {
      setMic(await capture(5, { save: true }));
    } catch (err) {
      setMic({ error: `${err?.name ?? ""} ${err?.message ?? err}`.trim() });
    } finally {
      setBusy(null);
      setProgress(null);
    }
  }

  async function runBg() {
    setBusy("bg");
    setBg(null);
    try {
      setBg(await capture(60, { watchVisibility: true, useWakeLock: true }));
    } catch (err) {
      setBg({ error: `${err?.name ?? ""} ${err?.message ?? err}`.trim() });
    } finally {
      setBusy(null);
      setProgress(null);
    }
  }

  function runGeo() {
    setBusy("geo");
    setGeo(null);
    const t0 = performance.now();
    if (!navigator.geolocation) {
      setGeo({ error: "位置情報の機能が、この環境にありません" });
      setBusy(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGeo({
          ms: performance.now() - t0,
          accuracy: pos.coords.accuracy,
          // 座標は、画面を共有しても、場所が分からないよう、下の桁を伏せる（小数2桁＝約1km）
          lat: pos.coords.latitude.toFixed(2),
          lon: pos.coords.longitude.toFixed(2),
          altitude: pos.coords.altitude,
        });
        setBusy(null);
      },
      (err) => {
        setGeo({ ms: performance.now() - t0, error: `${err.message || "取得できませんでした"}（コード ${err.code}：1＝許可されていない・2＝取得できない・3＝時間切れ）` });
        setBusy(null);
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
    );
  }

  // 結果の文章（コピー用）
  function reportText() {
    const lines = ["【録音の下見の結果】"];
    if (env) {
      lines.push(`環境：${env.platform}${env.native ? "（アプリ）" : "（ブラウザ）"} / ${env.origin} / 安全な接続=${env.support.secureContext}`);
      lines.push(`使える機能：getUserMedia=${env.support.getUserMedia} AudioContext=${env.support.audioContext} AudioWorklet=${env.support.audioWorklet} MediaRecorder=${env.support.mediaRecorder} 位置情報=${env.geolocation} 画面を点けたまま=${env.wakeLock}`);
      lines.push(`端末：${env.screen} / CPU ${env.cores} / メモリ ${env.memoryGb ?? "?"}GB / ${env.ua}`);
    }
    const dump = (name, r) => {
      if (!r) return;
      lines.push(`${name}：${JSON.stringify(r)}`);
    };
    dump("マイク5秒", mic);
    dump("画面を消す60秒", bg);
    dump("位置情報", geo);
    return lines.join("\n");
  }

  async function copyReport() {
    try {
      await navigator.clipboard.writeText(reportText());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("結果をコピーしてください", reportText());
    }
  }

  const s = env?.support;
  function MicResult({ r }) {
    if (!r) return null;
    if (r.error) return <Row tone="ng" label="失敗：" value={r.error} />;
    const st = r.settings ?? {};
    const flag = (v) => (v === undefined ? "報告なし" : v ? "入っている" : "切れている");
    return (
      <div className="mt-2 flex flex-col gap-0.5">
        <Row tone="info" label="取り出し方：" value={`${r.mode}／サンプルレート ${r.sampleRate}Hz`} />
        <Row tone={st.echoCancellation === true ? "warn" : st.echoCancellation === false ? "ok" : "info"} label="エコー消し：" value={flag(st.echoCancellation)} />
        <Row tone={st.noiseSuppression === true ? "warn" : st.noiseSuppression === false ? "ok" : "info"} label="ノイズ抑制：" value={flag(st.noiseSuppression)} />
        <Row tone={st.autoGainControl === true ? "warn" : st.autoGainControl === false ? "ok" : "info"} label="音量の自動調整：" value={flag(st.autoGainControl)} />
        <Row tone="info" label="マイク：" value={r.label || "（名前なし）"} />
        <Row tone={r.ratio >= 0.97 ? "ok" : "warn"} label="取りこぼし：" value={`${(r.ratio * 100).toFixed(1)}%取れた（${r.samples}サンプル）／最大の途切れ ${Math.round(r.maxGapMs)}ms`} />
        <Row tone="info" label="音の大きさ：" value={`平均 ${dbText(r.rmsDb)}／最大 ${dbText(r.peakDb)}`} />
        {r.write &&
          (r.write.skipped ? (
            <Row tone="info" label="端末への書き込み：" value={r.write.skipped} />
          ) : r.write.error ? (
            <Row tone="ng" label="端末への書き込み：" value={r.write.error} />
          ) : (
            <Row tone="ok" label="端末への書き込み：" value={`${Math.round(r.write.bytesWritten / 1024)}KB（${r.write.seconds.toFixed(0)}秒分）を ${Math.round(r.write.ms)}ms で書けた（保存されたサイズ ${Math.round(r.write.sizeOnDisk / 1024)}KB）`} />
          ))}
      </div>
    );
  }

  return (
    <div className="abl-page-safe min-h-screen w-full flex justify-center bg-page px-6">
      <div className="w-full max-w-sm bg-page rounded-[28px] border-[6px] border-white shadow-xl overflow-hidden pb-6">
        <BackLink fallbackHref="/" className="block px-4 pt-4 text-xs font-bold text-[#3F6C74]">
          ‹ 戻る
        </BackLink>

        <div className={card}>
          <div className="font-display text-xl">録音の下見</div>
          <p className="mt-1 text-[11px] text-inkMuted leading-relaxed">
            この端末で、録音に必要な機能が使えるかを確かめます（開発用の画面）。録音した音は、どこにも送られず、確かめたあとに消えます。
          </p>
        </div>

        <>
            <div className={card}>
              <div className="text-xs font-bold text-ink mb-2">① この端末の環境</div>
              {!env ? (
                <p className="text-[11px] text-inkMuted">確認中…</p>
              ) : (
                <div className="flex flex-col gap-0.5">
                  <Row tone="info" label="種類：" value={`${env.platform}（${env.native ? "アプリ" : "ブラウザ"}）`} />
                  <Row tone={s.secureContext ? "ok" : "ng"} label="安全な接続：" value={`${s.secureContext ? "はい" : "いいえ"}（${env.origin}）`} />
                  <Row tone={s.getUserMedia ? "ok" : "ng"} label="マイクの取得：" value={yesno(s.getUserMedia)} />
                  <Row tone={s.audioWorklet ? "ok" : "warn"} label="AudioWorklet：" value={`${yesno(s.audioWorklet)}${s.audioWorklet ? "" : "（古い方法に切り替えます）"}`} />
                  <Row tone="info" label="MediaRecorder：" value={yesno(s.mediaRecorder)} />
                  <Row tone={env.geolocation ? "ok" : "ng"} label="位置情報：" value={yesno(env.geolocation)} />
                  <Row tone={env.wakeLock ? "ok" : "warn"} label="画面を点けたままにする：" value={yesno(env.wakeLock)} />
                  <Row tone={env.online ? "ok" : "warn"} label="電波：" value={env.online ? "つながっている" : "つながっていない"} />
                  <Row tone="info" label="端末：" value={`${env.screen}／CPU ${env.cores}／メモリ ${env.memoryGb ?? "不明"}GB`} />
                </div>
              )}
            </div>

            <div className={card}>
              <div className="text-xs font-bold text-ink mb-1">② マイクのテスト（5秒）</div>
              <p className="text-[11px] text-inkMuted leading-relaxed mb-3">
                押すと、マイクの許可を求められます（許可してください）。5秒間、鳥の声や、手を叩く音などを聞かせてください。
              </p>
              <button onClick={runMic} disabled={!!busy} className={btn}>
                {busy === "mic" ? `録音中… ${progress ?? 0}秒` : "マイクをテストする"}
              </button>
              {(busy === "mic" || busy === "bg") && (
                <div className="mt-3">
                  <canvas ref={canvasRef} width={640} height={280} className="w-full rounded-lg bg-black" />
                  {level && (
                    <p className="mt-1 text-[10px] text-inkMuted tabular-nums">
                      音の大きさ：平均 {dbText(level.rms)}／最大 {dbText(level.peak)}
                    </p>
                  )}
                </div>
              )}
              <MicResult r={mic} />
            </div>

            <div className={card}>
              <div className="text-xs font-bold text-ink mb-1">③ 位置情報のテスト</div>
              <p className="text-[11px] text-inkMuted leading-relaxed mb-3">押すと、位置情報の許可を求められます。屋外だと、精度が良くなります。</p>
              <button onClick={runGeo} disabled={!!busy} className={btn}>
                {busy === "geo" ? "取得中…（最長20秒）" : "位置情報を取得する"}
              </button>
              {geo && (
                <div className="mt-2 flex flex-col gap-0.5">
                  {geo.error ? (
                    <Row tone="ng" label="失敗：" value={geo.error} />
                  ) : (
                    <>
                      <Row tone={geo.accuracy <= 50 ? "ok" : "warn"} label="精度：" value={`約 ${Math.round(geo.accuracy)}m`} />
                      <Row tone="info" label="かかった時間：" value={`${(geo.ms / 1000).toFixed(1)}秒`} />
                      <Row tone="info" label="場所（下の桁は伏せています）：" value={`${geo.lat}, ${geo.lon}`} />
                    </>
                  )}
                </div>
              )}
            </div>

            <div className={card}>
              <div className="text-xs font-bold text-ink mb-1">④ 画面を消したときのテスト（60秒）</div>
              <p className="text-[11px] text-inkMuted leading-relaxed mb-3">
                押したら、<b>電源ボタンで画面を消して、20秒ほど待ってから、また点けてください</b>。録音が続いていたか（音が取れていたか）を調べます。
              </p>
              <button onClick={runBg} disabled={!!busy} className={btn}>
                {busy === "bg" ? `測定中… ${progress ?? 0}秒 / 60秒` : "60秒のテストを始める"}
              </button>
              {bg &&
                (bg.error ? (
                  <Row tone="ng" label="失敗：" value={bg.error} />
                ) : (
                  <div className="mt-2 flex flex-col gap-0.5">
                    <Row tone={bg.ratio >= 0.97 ? "ok" : "ng"} label="音が取れた割合：" value={`${(bg.ratio * 100).toFixed(1)}%（100%に近いほど、途切れなし）`} />
                    <Row tone={bg.maxGapMs <= 250 ? "ok" : "ng"} label="最大の途切れ：" value={`${(bg.maxGapMs / 1000).toFixed(1)}秒`} />
                    <Row tone="info" label="途切れた場所：" value={bg.gaps.length ? bg.gaps.map((g) => `${g.atSec}秒に${g.gapSec}秒`).join("、") : "なし"} />
                    <Row tone="info" label="画面の切り替わり：" value={bg.visLog.length ? bg.visLog.map((v) => `${v.atSec}秒:${v.state === "hidden" ? "消えた" : "点いた"}`).join("、") : "記録なし（画面を消さなかった？）"} />
                    <Row tone={bg.wakeResult?.startsWith("取得できた") ? "ok" : "warn"} label="画面を点けたまま：" value={bg.wakeResult ?? "対応していない"} />
                    <Row tone="info" label="終わりの状態：" value={JSON.stringify(bg.trackStateEnd)} />
                  </div>
                ))}
            </div>

            <div className={card}>
              <button onClick={copyReport} className={btn}>
                {copied ? "コピーしました" : "結果をまとめてコピーする"}
              </button>
              <p className="mt-2 text-[10px] text-inkMuted leading-relaxed">コピーした文章か、この画面のスクリーンショットを、私に見せてください。</p>
            </div>
        </>
      </div>
    </div>
  );
}
