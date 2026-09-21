"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import BackLink from "./BackLink";
import RecorderSettingsPanel from "./RecorderSettingsPanel";
import { useLoginState } from "../lib/useLoginState";
import { supabase } from "../lib/supabaseClient";
import { isNativeApp } from "../lib/offline";
import { startRecording, MAX_RECORDING_SEC } from "../lib/recorder";
import { getPosition, loadPlaces, nearestPlace } from "../lib/geo";
import { loadSettings } from "../lib/recorderSettings";
import { deviceLabel, getDeviceInfo } from "../lib/deviceInfo";

const card = "mx-4 mt-2.5 mb-3 bg-white border-[3px] border-cardBorder rounded-2xl p-4";
const chip = "inline-flex items-center gap-1 rounded-full border-2 border-cardBorder bg-page px-2.5 py-1 text-[11px] font-bold";

const mmss = (sec) => {
  const s = Math.max(0, Math.floor(sec));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

// 場所の状態 → 録音の情報に入れる形
function toMetaLocation(loc) {
  if (!loc || loc.status === "checking" || loc.latitude == null) {
    return { latitude: null, longitude: null, accuracyM: null, source: "none", name: null };
  }
  return { latitude: loc.latitude, longitude: loc.longitude, accuracyM: loc.accuracyM ?? null, source: loc.status, name: loc.name ?? null };
}

// 🔥 録音画面。録音ボタンを押すと、マイクの音を、端末の中に保存する（無圧縮＋別の録音）。
//    録音中：スペクトログラム（2D）のリアルタイム表示・音量メーター。画面を消しても、別の録音は続く
export default function RecordScreen() {
  const login = useLoginState();
  const native = isNativeApp();
  const [settings, setSettings] = useState({ recorderName: "", defaultLocation: null });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [phase, setPhase] = useState("idle"); // idle | starting | recording | done
  const [error, setError] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState({ rmsDb: -120, peakDb: -120 });
  const [live, setLive] = useState(null); // 録音中の様子
  const [result, setResult] = useState(null); // 録音が終わったときの情報
  const [loc, setLoc] = useState({ status: "checking" });
  const [online, setOnline] = useState(true);
  const [dim, setDim] = useState(false);
  const canvasRef = useRef(null);
  const ctrlRef = useRef(null);
  const locRef = useRef(loc);
  locRef.current = loc;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  useEffect(() => {
    setSettings(loadSettings());
    setOnline(navigator.onLine);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  // 場所：位置情報（GPS）を取る。取れなければ、デフォルトの場所。近くに、これまでの場所があれば、その名前を提案する
  const refreshLocation = useCallback(async () => {
    setLoc({ status: "checking" });
    let next;
    try {
      const pos = await getPosition();
      let name = null;
      let nearDistanceM = null;
      try {
        const near = nearestPlace(pos, await loadPlaces(), 300);
        if (near) {
          name = near.place.name;
          nearDistanceM = Math.round(near.distanceM);
        }
      } catch {
        // 名前の提案は、なくてもよい
      }
      next = { status: "gps", ...pos, name, nearDistanceM };
    } catch (err) {
      const dl = settingsRef.current.defaultLocation;
      if (dl && dl.latitude != null && dl.longitude != null) next = { status: "default", latitude: dl.latitude, longitude: dl.longitude, accuracyM: null, name: dl.name || null, message: err.message };
      else next = { status: "none", message: err.message };
    }
    setLoc(next);
    ctrlRef.current?.setLocation(toMetaLocation(next)); // 録音を始めたあとに、場所が取れたとき
  }, []);

  useEffect(() => {
    if (login.loggedIn) refreshLocation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [login.loggedIn]);

  // 録音中：画面の更新（スペクトログラム・時間・音量）
  useEffect(() => {
    if (phase !== "recording") return;
    let raf = 0;
    let last = 0;
    const loop = (now) => {
      const c = ctrlRef.current;
      if (c) {
        if (!dim && canvasRef.current) c.draw(canvasRef.current);
        if (now - last > 120) {
          last = now;
          setElapsed(c.elapsedSec());
          setLevel(c.level());
          setLive(c.status());
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [phase, dim]);

  async function start() {
    setError(null);
    setResult(null);
    setPhase("starting");
    try {
      const { data } = await supabase.auth.getSession();
      const ctrl = await startRecording({
        recorder: { userId: data?.session?.user?.id ?? null, name: settingsRef.current.recorderName },
        location: toMetaLocation(locRef.current),
        onEnded: (meta) => {
          ctrlRef.current = null;
          setDim(false);
          setResult(meta);
          setPhase("done");
        },
      });
      ctrlRef.current = ctrl;
      setElapsed(0);
      setPhase("recording");
    } catch (err) {
      console.error(err);
      setPhase("idle");
      setError(
        err?.name === "NotAllowedError" || err?.name === "SecurityError"
          ? "マイクが許可されていません。端末の設定で、このアプリのマイクを許可してから、もう一度お試しください。"
          : err?.name === "NotFoundError"
            ? "マイクが見つかりません。"
            : `録音を始められませんでした（${err?.message ?? err}）`
      );
    }
  }

  async function stop() {
    await ctrlRef.current?.stop("停止ボタン");
  }

  // 画面から離れるときに、録音中なら、そこまでを保存して終える
  useEffect(() => {
    return () => {
      ctrlRef.current?.stop("画面を閉じた");
    };
  }, []);

  const recording = phase === "recording";
  const locText = (() => {
    if (loc.status === "checking") return "場所を確認中…";
    if (loc.status === "gps") return `GPS${loc.accuracyM != null ? `（約${Math.round(loc.accuracyM)}m）` : ""}${loc.name ? `：${loc.name}` : "：名前なし"}`;
    if (loc.status === "default") return `デフォルト：${loc.name || "名前なし"}`;
    return "場所なし";
  })();
  const dev = typeof window !== "undefined" ? deviceLabel(getDeviceInfo()) : "";
  const interrupted = live && live.ctxState && live.ctxState !== "running";

  return (
    <div className="abl-page-safe min-h-screen w-full flex justify-center bg-page px-6">
      <div className="w-full max-w-sm bg-page rounded-[28px] border-[6px] border-white shadow-xl overflow-hidden pb-6">
        <BackLink fallbackHref="/" className="block px-4 pt-4 text-xs font-bold text-[#3F6C74]">
          ‹ 戻る
        </BackLink>

        <div className={card}>
          <div className="flex items-center justify-between">
            <div className="font-display text-xl">録音</div>
            <button onClick={() => setSettingsOpen((v) => !v)} disabled={recording} className="text-[11px] font-bold text-[#3F6C74] underline underline-offset-2 disabled:opacity-40">
              ⚙ 設定
            </button>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <span className={chip}>
              📍 {locText}
            </span>
            <span className={`${chip} ${online ? "" : "!border-[#C2860A] text-[#C2860A]"}`}>{online ? "📶 電波あり" : "📴 電波なし（録音だけ・あとで解析）"}</span>
            <span className={chip}>📱 {dev}</span>
          </div>
          {!recording && loc.status !== "checking" && loc.status !== "gps" && loc.message && <p className="mt-2 text-[10px] text-[#C2860A] leading-relaxed">位置情報：{loc.message}。{loc.status === "none" ? "設定で、デフォルトの場所を入れると、それを使います。" : ""}</p>}
          {!recording && (
            <button onClick={refreshLocation} className="mt-2 text-[10px] font-bold text-[#3F6C74] underline underline-offset-2">
              場所を取り直す
            </button>
          )}
          {!login.ready ? <p className="mt-2 text-[11px] text-inkMuted">確認中…</p> : !login.loggedIn ? <p className="mt-2 text-[11px] text-red-500">この画面は、ログイン中の人だけが使えます。</p> : null}
          {login.loggedIn && !native && <p className="mt-2 text-[10px] text-[#C2860A] leading-relaxed">ブラウザでは、録音は保存されません（試験用。ページを閉じると消えます）。アプリで使ってください。</p>}
        </div>

        {settingsOpen && !recording && (
          <div className={card}>
            <div className="text-xs font-bold text-ink mb-2">設定</div>
            <RecorderSettingsPanel settings={settings} onChange={setSettings} currentPosition={loc.status === "gps" ? loc : null} />
          </div>
        )}

        {login.loggedIn && (
          <div className={card}>
            <div className="relative rounded-lg overflow-hidden bg-black">
              <canvas ref={canvasRef} width={640} height={280} className="w-full block" />
              {!recording && <div className="absolute inset-0 flex items-center justify-center text-[11px] text-white/60">録音を始めると、ここに、音が流れます</div>}
            </div>
            {recording && (
              <>
                <div className="mt-2 flex items-center justify-between text-[11px] tabular-nums text-ink">
                  <span className="font-bold text-red-500">● 録音中 {mmss(elapsed)}</span>
                  <span className="text-inkMuted">最長 {mmss(MAX_RECORDING_SEC)}</span>
                </div>
                <div className="mt-1 h-2 rounded-full bg-[#E9E6E1] overflow-hidden">
                  <div className="h-full bg-[#3F6C74] transition-[width] duration-100" style={{ width: `${Math.max(0, Math.min(100, ((level.rmsDb + 90) / 70) * 100))}%` }} />
                </div>
                <div className="mt-1 text-[10px] text-inkMuted tabular-nums">音の大きさ：{level.rmsDb.toFixed(0)} dBFS</div>
                {interrupted && <p className="mt-2 rounded-lg bg-[#FFF6E0] p-2 text-[10px] leading-relaxed text-[#8A5A00]">画面が消えているため、無圧縮の録音が止まっています。別の録音（AAC）は続いています。</p>}
                {live && !live.aacOk && <p className="mt-2 rounded-lg bg-[#FDEAEA] p-2 text-[10px] leading-relaxed text-red-500">別の録音（AAC）が動いていません。画面を消すと、途切れることがあります。</p>}
                {live?.writeError && <p className="mt-2 rounded-lg bg-[#FDEAEA] p-2 text-[10px] leading-relaxed text-red-500">端末に書き込めていません。容量を確認してください。</p>}
              </>
            )}
            {error && <p className="mt-2 text-[11px] text-red-500 leading-relaxed">{error}</p>}

            <button
              onClick={recording ? stop : start}
              disabled={phase === "starting" || !login.loggedIn}
              className={`mt-3 w-full rounded-2xl py-4 text-base font-bold text-white disabled:opacity-40 ${recording ? "bg-[#3F6C74]" : "bg-[#D9534F]"}`}
            >
              {phase === "starting" ? "準備中…" : recording ? "■ 停止して保存する" : "● 録音を始める"}
            </button>
            {recording && (
              <button onClick={() => setDim(true)} className="mt-2 w-full rounded-xl border-2 border-cardBorder bg-white py-2.5 text-[12px] font-bold text-[#3F6C74]">
                🌙 画面を暗くする（録音は続きます・電池の節約）
              </button>
            )}
            {!recording && <p className="mt-2 text-[10px] text-inkMuted leading-relaxed">録音は、この端末の中に保存されます（電波が無くても録れます）。画面を消しても、別の録音（AAC）は続きます。</p>}
            {recording && <p className="mt-2 text-[10px] text-inkMuted leading-relaxed">この画面を離れると、録音は終わります（そこまでは、保存されます）。アプリを閉じるときは、先に、停止してください。</p>}
          </div>
        )}

        {result && (
          <div className={card}>
            <div className="text-xs font-bold text-[#3F6C74]">✓ 保存しました</div>
            <ul className="mt-1 text-[11px] text-ink leading-relaxed">
              <li>長さ：{mmss(result.durationSec)}（{result.stopReason}）</li>
              <li>正式な録音：{result.audio.master === "pcm" ? "無圧縮" : "別の録音（AAC）※無圧縮が途切れたため"}（無圧縮が取れた割合 {Math.round((result.audio.pcm.coverage ?? 0) * 100)}%）</li>
              <li>場所：{result.location.source === "gps" ? "GPS" : result.location.source === "default" ? "デフォルト" : "なし"}{result.location.name ? `（${result.location.name}）` : ""}</li>
              {result.interruptions.length > 0 && <li>無圧縮が途切れた回数：{result.interruptions.length}回</li>}
              {result.status === "error" && <li className="text-red-500">端末への書き込みに失敗しました。そこまでの音は、保存されています。</li>}
              <li>
                音のサイズ：無圧縮 {Math.round((result.audio.pcm.samples * 2) / 1024)}KB・AAC {Math.round((result.audio.aac.bytes ?? 0) / 1024)}KB{result.audio.aac.ok ? "" : "（別の録音は動きませんでした）"}
              </li>
            </ul>
            <details className="mt-2 text-[10px] text-inkMuted">
              <summary className="cursor-pointer font-bold">出来事の記録（{result.events.length}件）</summary>
              <ul className="mt-1 max-h-40 overflow-y-auto leading-relaxed tabular-nums">
                {result.events.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </details>
            <div className="mt-3 flex gap-2">
              <Link href="/recordings" className="flex-1 rounded-xl bg-[#3F6C74] py-2.5 text-center text-[12px] font-bold text-white">
                録音の一覧を見る
              </Link>
              <button onClick={() => setResult(null)} className="flex-1 rounded-xl border-2 border-cardBorder bg-white py-2.5 text-[12px] font-bold text-[#3F6C74]">
                閉じる
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 画面を暗くする：黒い画面（有機ELは、黒だと、電池を、ほとんど使わない）。タップで戻る。録音は、そのまま続く */}
      {dim && (
        <button onClick={() => setDim(false)} className="fixed inset-0 z-[90] flex flex-col items-center justify-center bg-black text-white/25" aria-label="画面を明るくする">
          <span className="text-2xl tabular-nums">{mmss(elapsed)}</span>
          <span className="mt-2 text-[11px]">録音中（タップで、画面を明るくします）</span>
        </button>
      )}
    </div>
  );
}
