"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import BackLink from "./BackLink";
import RecorderSettingsPanel from "./RecorderSettingsPanel";
import LiveBirds from "./LiveBirds";
import { useLoginState } from "../lib/useLoginState";
import { supabase } from "../lib/supabaseClient";
import { isNativeApp } from "../lib/offline";
import { startRecording, MAX_RECORDING_SEC } from "../lib/recorder";
import { getPosition, loadPlaces, nearestPlace } from "../lib/geo";
import { loadSettings } from "../lib/recorderSettings";
import { deviceLabel, getDeviceInfo } from "../lib/deviceInfo";
import { createLiveAnalysis, warmLiveServer } from "../lib/liveAnalysis";
import { compactResult, emptyLive, listLive, mergeLive } from "../lib/liveSpecies";
import { useSwipeNav } from "../lib/useSwipeNav";

const LIVE_ON_KEY = "abl.recorder.live"; // リアルタイム解析の入・切（この端末だけの設定）
const WARM_VALID_MS = 2.5 * 60 * 1000; // サーバーは、最後の呼び出しから5分で眠る。この時間より前の合図は「まだ起きている」とみなして、送り直さない
const KEEP_WARM_INTERVAL_MS = 170 * 1000; // まめに起こしておく間隔（5分の眠りより、じゅうぶん短く）
const KEEP_WARM_IDLE_STOP_MS = 60 * 60 * 1000; // これだけ録音していなければ、まめに起こすのをやめる（フィールドを離れた・放置とみなす）

// 🔥 トップページ（MinimalHome）と、同じ見た目の部品：黒っぽいガラスのカード・チップ・ボタン
const card = "mx-4 mt-2.5 mb-3 rounded-2xl border border-white/15 bg-black/30 p-4 backdrop-blur-md";
const chip = "inline-flex items-center gap-1 rounded-full border border-white/30 bg-white/10 px-2.5 py-1 text-[11px] font-bold text-white";
const ghostBtn = "rounded-xl border border-white/30 bg-white/10 py-2.5 text-[12px] font-bold text-white hover:border-white/60 disabled:opacity-40";

const mmss = (sec) => {
  const s = Math.max(0, Math.floor(sec));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

// たたんだ表示 ⇄ 詳しい表示の、開閉の三角
function TriangleIcon({ direction }) {
  const points = direction === "up" ? "14,2 26,18 2,18" : "2,2 26,2 14,18";
  return (
    <svg width="28" height="20" viewBox="0 0 28 20" aria-hidden="true">
      <polygon points={points} fill="currentColor" opacity="0.7" />
    </svg>
  );
}

// 場所の状態 → 録音の情報に入れる形
function toMetaLocation(loc) {
  if (!loc || loc.status === "checking" || loc.latitude == null) {
    return { latitude: null, longitude: null, accuracyM: null, source: "none", name: null };
  }
  return { latitude: loc.latitude, longitude: loc.longitude, accuracyM: loc.accuracyM ?? null, source: loc.status, name: loc.name ?? null };
}

// 🔥 録音画面。録音ボタンを押すと、マイクの音を、端末の中に保存する（無圧縮＋別の録音）。
//    録音中：スペクトログラム（2D）のリアルタイム表示・音量メーター。画面を消しても、別の録音は続く
//    ログイン中は、アプリを開いた、その最初の1回に限って、この画面が最初に出る（app/page.js）。
//    右から左へスワイプすると、トップページへ戻る（録音中は、スワイプは効かない）
export default function RecordScreen() {
  const login = useLoginState();
  const native = isNativeApp();
  const router = useRouter();
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
  const [discarding, setDiscarding] = useState(false); // 「破棄する」の確認を出している
  const [liveOn, setLiveOn] = useState(true);
  const [liveAgg, setLiveAgg] = useState(emptyLive());
  const [liveState, setLiveState] = useState(null);
  const [warm, setWarm] = useState("idle"); // idle | warming | ready | failed（解析サーバーを起こした結果）
  const [expanded, setExpanded] = useState(false); // たたんだ表示（false）⇄ 今までの詳しい表示（true）。録音していないときだけ使う
  const canvasRef = useRef(null);
  const ctrlRef = useRef(null);
  const engineRef = useRef(null);
  const liveOnRef = useRef(true);
  liveOnRef.current = liveOn;
  const warmedRef = useRef({ key: "", at: 0 }); // 最後に起こした場所と時刻
  const lastActivityRef = useRef(Date.now()); // 最後に録音した時刻（まめに起こすのを、いつやめるかの目安）
  const locRef = useRef(loc);
  locRef.current = loc;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const recording = phase === "recording";

  // 🔥 右から左へスワイプすると、トップページへ戻る（録音中は、無効）
  const { dragPercent: swipePercent, dragging: swiping, handlers: swipeHandlers } = useSwipeNav({
    direction: "left",
    enabled: !recording,
    onCommit: () => router.push("/"),
  });
  const swipeStyle = {
    transform: swipePercent > 0 ? `translateX(-${swipePercent * 100}%)` : undefined,
    transition: swiping ? "none" : "transform 320ms ease-out",
  };

  useEffect(() => {
    setSettings(loadSettings());
    try {
      if (localStorage.getItem(LIVE_ON_KEY) === "0") setLiveOn(false);
    } catch {
      // 保存された設定が読めなければ、入のまま
    }
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

  function toggleLive() {
    const next = !liveOnRef.current;
    setLiveOn(next);
    try {
      localStorage.setItem(LIVE_ON_KEY, next ? "1" : "0");
    } catch {
      // 保存できなくても、今回の録音では、そのまま使える
    }
  }

  // 解析サーバーを、先に起こしておく（録音の画面を開いたとき・電波が戻ったとき）。起きるまで、約20秒かかる
  //   場所が分かってから呼ぶ（その場所の種の一覧も、先に作っておく＝録音を始めてすぐ、速く返る）。場所が変わったら、もう一度
  const wakeServer = useCallback(async (place) => {
    const key = place ? `${place.latitude.toFixed(3)},${place.longitude.toFixed(3)}` : "none";
    const last = warmedRef.current;
    if (last.key === key && Date.now() - last.at < WARM_VALID_MS) return;
    warmedRef.current = { key, at: Date.now() };
    setWarm("warming");
    const ok = await warmLiveServer(place);
    if (!ok) warmedRef.current = { key: "", at: 0 }; // 失敗したときは、次の機会に、やり直す
    setWarm(ok ? "ready" : "failed");
  }, []);

  const placeLat = loc.latitude ?? null;
  const placeLon = loc.longitude ?? null;
  useEffect(() => {
    if (!login.loggedIn || !liveOn || !online || loc.status === "checking") return;
    wakeServer(placeLat != null && placeLon != null ? { latitude: placeLat, longitude: placeLon } : null);
  }, [login.loggedIn, liveOn, online, loc.status, placeLat, placeLon, wakeServer]);

  // フィールドで、次の録音まで、サーバーを起こしたままにしておく：この画面を開いている間、まめに（5分の眠りより短い、約3分おきに）合図を送る。
  //   ・画面がロックされている間も、送る（iPhone は、録音中であれば、別の録音〔AAC〕が動いているぶん、音の処理が続くので、JS も動く。
  //     録音していないときは、iPhone の仕組み上、ロック中はこの合図自体も止まることがある＝次に画面を開いたときに、また送られる）
  //   ・録音中でも、送る（iPhone は、画面を消すと、無圧縮の処理〔と、それに乗るリアルタイム解析〕が止まるため、
  //     解析の呼び出しだけでは、サーバーが起きたままにならないことがある。画面を開き直したとき、すぐ使えるように）
  //   ・60分、録音していなければ、やめる（フィールドを離れた・放置とみなす）
  useEffect(() => {
    if (!login.loggedIn || !liveOn || !online) return;
    const tick = () => {
      if (Date.now() - lastActivityRef.current > KEEP_WARM_IDLE_STOP_MS) return; // 使わなくなったので、そっとしておく
      wakeServer(placeLat != null && placeLon != null ? { latitude: placeLat, longitude: placeLon } : null);
    };
    const timer = setInterval(tick, KEEP_WARM_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [login.loggedIn, liveOn, online, placeLat, placeLon, wakeServer]);

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
    setDiscarding(false);
    lastActivityRef.current = Date.now();
    setPhase("starting");
    setLiveAgg(emptyLive());
    setLiveState(null);
    engineRef.current?.stop();
    const engine = createLiveAnalysis({
      getLocation: () => (locRef.current.latitude != null ? locRef.current : null),
      isEnabled: () => liveOnRef.current,
      onState: setLiveState,
      onResult: (r) => {
        setLiveAgg((prev) => mergeLive(prev, r));
        ctrlRef.current?.addLive(compactResult(r));
      },
    });
    engineRef.current = engine;
    try {
      const { data } = await supabase.auth.getSession();
      const ctrl = await startRecording({
        recorder: { userId: data?.session?.user?.id ?? null, name: settingsRef.current.recorderName },
        location: toMetaLocation(locRef.current),
        onChunk: engine.push,
        onEnded: (meta) => {
          engine.stop();
          ctrlRef.current = null;
          lastActivityRef.current = Date.now();
          setDim(false);
          setResult(meta);
          setPhase("done");
          setExpanded(true); // 録音が終わったら、結果と一緒に、詳しい表示に戻す
        },
        onDiscarded: () => {
          engine.stop();
          ctrlRef.current = null;
          lastActivityRef.current = Date.now();
          setDim(false);
          setDiscarding(false);
          setPhase("idle");
        },
      });
      ctrlRef.current = ctrl;
      setElapsed(0);
      setPhase("recording");
    } catch (err) {
      console.error(err);
      engine.stop();
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

  async function discard() {
    await ctrlRef.current?.discard("破棄ボタン");
  }

  // 画面から離れるときに、録音中なら、そこまでを保存して終える
  useEffect(() => {
    return () => {
      engineRef.current?.stop();
      ctrlRef.current?.stop("画面を閉じた");
    };
  }, []);

  const locText = (() => {
    if (loc.status === "checking") return "場所を確認中…";
    if (loc.status === "gps") return `GPS${loc.accuracyM != null ? `（約${Math.round(loc.accuracyM)}m）` : ""}${loc.name ? `：${loc.name}` : "：名前なし"}`;
    if (loc.status === "default") return `デフォルト：${loc.name || "名前なし"}`;
    return "場所なし";
  })();
  const dev = typeof window !== "undefined" ? deviceLabel(getDeviceInfo()) : "";
  const interrupted = live && live.ctxState && live.ctxState !== "running";
  const liveList = listLive(liveAgg, recording ? elapsed : 1e9);
  const showLive = recording || liveAgg.windows > 0;
  const warmText = warm === "warming" ? "☁ 解析サーバーを起こしています…" : warm === "ready" ? "☁ 解析サーバー：準備OK" : warm === "failed" ? "☁ 解析サーバー：つながりません" : null;

  // 🔥 たたんだ表示・録音中の表示で使う、英語の短いステータス（機器の読み取りふうの見た目）
  const gpsOk = loc.status === "gps" || loc.status === "default";
  const gpsDetail = loc.status === "gps" ? `~${Math.round(loc.accuracyM ?? 0)}m` : loc.status === "default" ? "default" : loc.status === "checking" ? "…" : "none";
  const analysisText = warm === "ready" ? "OK" : warm === "warming" ? "…" : warm === "failed" ? "NG" : "—";
  const statusLines = [
    `${gpsOk ? "OK" : "…"} | GPS / ${gpsDetail}`,
    `${online ? "OK" : "NG"} | Mobile NetWork`,
    `${liveOn ? "ON" : "OFF"} | Live Analysis`,
    `${liveOn ? analysisText : "OFF"} | Analysis Server Connection`,
  ];

  const collapsedIdle = !recording && !expanded && login.loggedIn;

  return (
    <div className="relative w-full overflow-x-hidden" style={{ touchAction: "pan-y" }} {...swipeHandlers}>
      <div className="abl-page-safe relative z-10 flex min-h-screen w-full justify-center px-6 pb-10" style={swipeStyle}>
        <div className="w-full max-w-sm">
          {/* 🔥 たたんだ表示：録音していない・ログイン中・まだ開いていないときだけ（最初は、これが出る） */}
          {collapsedIdle && (
            <div className="flex flex-col items-center pt-12">
              <div className="w-full text-[11px] leading-relaxed text-white/85">
                <div className="font-bold">Ambient Bird Log - Analysis</div>
                <div className="text-white/40">—</div>
                {statusLines.map((line) => (
                  <div key={line}>{line}</div>
                ))}
              </div>
              <button onClick={() => setExpanded(true)} aria-label="詳しい表示を開く" className="mt-10 text-white/70 hover:text-white">
                <TriangleIcon direction="up" />
              </button>
              <button
                onClick={start}
                disabled={phase === "starting"}
                aria-label="録音を始める"
                className="relative mt-6 flex h-40 w-40 items-center justify-center rounded-full disabled:opacity-50"
              >
                <span className="absolute inset-0 rounded-full border border-white/70" />
                <span className="absolute inset-[10px] rounded-full border border-white/70" />
                <span className="absolute inset-5 rounded-full bg-white/25" />
              </button>
              {phase === "starting" && <p className="mt-4 text-[11px] text-white/70">準備中…</p>}
              {error && <p className="mt-4 text-center text-[11px] leading-relaxed text-[#F0B4AE]">{error}</p>}
            </div>
          )}

          {!collapsedIdle && (
            <div className="flex items-center justify-between px-1">
              <BackLink fallbackHref="/" className="text-xs font-bold text-white/80 hover:text-white">
                ‹ 戻る
              </BackLink>
              <span className="text-[9px] tracking-wide text-white/35">◀ スワイプでトップへ</span>
            </div>
          )}

          {/* 🔥 録音中：英語のステータス＋透過のスペクトログラム（背景の写真の上に、直接） */}
          {recording && (
            <>
              <div className="mt-2 px-1 text-[11px] leading-relaxed text-white/85">
                <div className="font-bold">Ambient Bird Log - Analysis</div>
                <div className="text-white/40">—</div>
                {statusLines.map((line) => (
                  <div key={line}>{line}</div>
                ))}
              </div>
              <canvas ref={canvasRef} width={640} height={280} className="mt-3 block w-full" />
            </>
          )}

          {!recording && expanded && login.loggedIn && (
            <button onClick={() => setExpanded(false)} aria-label="たたんだ表示に戻る" className="mx-auto mt-1 block text-white/70 hover:text-white">
              <TriangleIcon direction="down" />
            </button>
          )}

          {!recording && (expanded || !login.loggedIn) && (
          <div className={card}>
            <div className="flex items-center justify-between">
              <div className="font-display text-xl text-white">録音</div>
              <button onClick={() => setSettingsOpen((v) => !v)} disabled={recording} className="text-[11px] font-bold text-white/80 underline underline-offset-2 disabled:opacity-40">
                ⚙ 設定
              </button>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <span className={chip}>📍 {locText}</span>
              <span className={`${chip} ${online ? "" : "!border-[#FFD27A]/50 !text-[#FFD27A]"}`}>{online ? "📶 電波あり" : "📴 電波なし（録音だけ・あとで解析）"}</span>
              <span className={chip}>📱 {dev}</span>
              <button onClick={toggleLive} className={`${chip} ${liveOn ? "!border-[#8FE0B0]/60 !text-[#8FE0B0]" : "text-white/55"}`}>
                🔍 リアルタイム解析：{liveOn ? "入" : "切"}
              </button>
              {liveOn && warmText && !recording && <span className={`${chip} ${warm === "failed" ? "!border-[#FFD27A]/50 !text-[#FFD27A]" : ""}`}>{warmText}</span>}
            </div>
            {!recording && loc.status !== "checking" && loc.status !== "gps" && loc.message && (
              <p className="mt-2 text-[10px] leading-relaxed text-[#FFD27A]">
                位置情報：{loc.message}。{loc.status === "none" ? "設定で、デフォルトの場所を入れると、それを使います。" : ""}
              </p>
            )}
            {!recording && (
              <button onClick={refreshLocation} className="mt-2 text-[10px] font-bold text-white/70 underline underline-offset-2 hover:text-white">
                場所を取り直す
              </button>
            )}
            {!login.ready ? (
              <p className="mt-2 text-[11px] text-white/55">確認中…</p>
            ) : !login.loggedIn ? (
              <p className="mt-2 text-[11px] text-[#F0B4AE]">この画面は、ログイン中の人だけが使えます。</p>
            ) : null}
            {login.loggedIn && !native && <p className="mt-2 text-[10px] leading-relaxed text-[#FFD27A]">ブラウザでは、録音は保存されません（試験用。ページを閉じると消えます）。アプリで使ってください。</p>}
          </div>
          )}

          {settingsOpen && !recording && (
            <div className={card}>
              <div className="mb-2 text-xs font-bold text-white">設定</div>
              <RecorderSettingsPanel settings={settings} onChange={setSettings} currentPosition={loc.status === "gps" ? loc : null} />
            </div>
          )}

          {!recording && expanded && login.loggedIn && (
            <div className={card}>
              <div className="relative overflow-hidden rounded-lg bg-black">
                <canvas ref={canvasRef} width={640} height={280} className="block w-full" />
                <div className="absolute inset-0 flex items-center justify-center text-[11px] text-white/50">録音を始めると、ここに、音が流れます</div>
              </div>
              {showLive && <LiveBirds list={liveList} state={liveState} enabled={liveOn} finished={!recording} />}
              {error && <p className="mt-2 text-[11px] leading-relaxed text-[#F0B4AE]">{error}</p>}
              <button
                onClick={start}
                disabled={phase === "starting" || !login.loggedIn}
                className="mt-3 w-full rounded-2xl bg-[#D9534F] py-4 text-base font-bold text-white disabled:opacity-40"
              >
                {phase === "starting" ? "準備中…" : "● 録音を始める"}
              </button>
              <p className="mt-2 text-[10px] leading-relaxed text-white/55">録音は、この端末の中に保存されます（電波が無くても録れます）。画面を消しても、別の録音（AAC）は続きます。</p>
            </div>
          )}

          {recording && (
            <div className={card}>
              <div className="flex items-center justify-between text-[11px] tabular-nums text-white">
                <span className="font-bold text-[#FF8C86]">● 録音中 {mmss(elapsed)}</span>
                <span className="text-white/55">最長 {mmss(MAX_RECORDING_SEC)}</span>
              </div>
              <div className="mt-1 h-2 overflow-hidden rounded-full bg-white/10">
                <div className="h-full bg-[#8FC2CB] transition-[width] duration-100" style={{ width: `${Math.max(0, Math.min(100, ((level.rmsDb + 90) / 70) * 100))}%` }} />
              </div>
              <div className="mt-1 text-[10px] tabular-nums text-white/55">音の大きさ：{level.rmsDb.toFixed(0)} dBFS</div>
              {interrupted && <p className="mt-2 rounded-lg bg-[#FFD27A]/15 p-2 text-[10px] leading-relaxed text-[#FFD27A]">画面が消えているため、無圧縮の録音が止まっています。別の録音（AAC）は続いています。</p>}
              {live && !live.aacOk && <p className="mt-2 rounded-lg bg-[#F0B4AE]/15 p-2 text-[10px] leading-relaxed text-[#F0B4AE]">別の録音（AAC）が動いていません。画面を消すと、途切れることがあります。</p>}
              {live?.writeError && <p className="mt-2 rounded-lg bg-[#F0B4AE]/15 p-2 text-[10px] leading-relaxed text-[#F0B4AE]">端末に書き込めていません。容量を確認してください。</p>}
              {showLive && <LiveBirds list={liveList} state={liveState} enabled={liveOn} finished={!recording} />}
              {error && <p className="mt-2 text-[11px] leading-relaxed text-[#F0B4AE]">{error}</p>}

              <button onClick={stop} disabled={discarding} className="mt-3 w-full rounded-2xl bg-[#3F6C74] py-4 text-base font-bold text-white disabled:opacity-40">
                ■ 停止して保存する
              </button>
              <button onClick={() => setDim(true)} className={`mt-2 w-full ${ghostBtn}`}>
                🌙 画面を暗くする（録音は続きます・電池の節約）
              </button>
              {!discarding && (
                <button onClick={() => setDiscarding(true)} className="mt-2 w-full rounded-xl border border-[#F0B4AE]/50 bg-[#F0B4AE]/10 py-2.5 text-[12px] font-bold text-[#F0B4AE] hover:border-[#F0B4AE]">
                  ❌ 破棄する（保存しない）
                </button>
              )}
              {discarding && (
                <div className="mt-2 rounded-xl border border-[#F0B4AE]/50 bg-[#F0B4AE]/10 p-3">
                  <div className="text-xs font-bold text-[#F0B4AE]">この録音を、保存せずに、やめますか？</div>
                  <p className="mt-1 text-[11px] leading-relaxed text-white/85">ここまでの音（無圧縮・AAC）が、端末から消えます。元に戻せません。</p>
                  <div className="mt-2 flex gap-2">
                    <button onClick={discard} className="flex-1 rounded-xl bg-[#D9534F] py-2.5 text-[12px] font-bold text-white">
                      破棄する
                    </button>
                    <button onClick={() => setDiscarding(false)} className={`flex-1 ${ghostBtn}`}>
                      やめる（録音を続ける）
                    </button>
                  </div>
                </div>
              )}
              <p className="mt-2 text-[10px] leading-relaxed text-white/55">この画面を離れると、録音は終わります（そこまでは、保存されます）。アプリを閉じるときは、先に、停止してください。</p>
            </div>
          )}

          {result && (
            <div className={card}>
              <div className="text-xs font-bold text-[#8FC2CB]">✓ 保存しました</div>
              <ul className="mt-1 text-[11px] leading-relaxed text-white/85">
                <li>長さ：{mmss(result.durationSec)}（{result.stopReason}）</li>
                <li>正式な録音：{result.audio.master === "pcm" ? "無圧縮" : "別の録音（AAC）※無圧縮が途切れたため"}（無圧縮が取れた割合 {Math.round((result.audio.pcm.coverage ?? 0) * 100)}%）</li>
                <li>場所：{result.location.source === "gps" ? "GPS" : result.location.source === "default" ? "デフォルト" : "なし"}{result.location.name ? `（${result.location.name}）` : ""}</li>
                {result.interruptions.length > 0 && <li>無圧縮が途切れた回数：{result.interruptions.length}回</li>}
                {result.status === "error" && <li className="text-[#F0B4AE]">端末への書き込みに失敗しました。そこまでの音は、保存されています。</li>}
                <li>
                  音のサイズ：無圧縮 {Math.round((result.audio.pcm.samples * 2) / 1024)}KB・AAC {Math.round((result.audio.aac.bytes ?? 0) / 1024)}KB{result.audio.aac.ok ? "" : "（別の録音は動きませんでした）"}
                </li>
              </ul>
              <details className="mt-2 text-[10px] text-white/55">
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
                <button onClick={() => setResult(null)} className={`flex-1 ${ghostBtn}`}>
                  閉じる
                </button>
              </div>
            </div>
          )}
        </div>
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
