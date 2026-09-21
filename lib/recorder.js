// 🔥 録音の本体。マイクの音を、2つの方法で、同時に、端末の中へ保存する。
//    ①無圧縮（PCM）：AudioWorklet で取り出した生の音（16bit・モノラル）。音質は最高。ただし iPhone は、画面を消すと、途切れる
//    ②別の録音（AAC・256kbps）：MediaRecorder。画面を消しても続く（iPhone・Android とも、下見で確認）。保険
//    録音が終わったとき、①が、ほぼ全部（98%以上）取れていれば、①を「正式な録音（master）」にする。足りなければ、②を正式にする。
//    ・割合は、最初の音が届いた時点から数える（録音の始めの、音の処理が立ち上がるまでの約0.2秒は、途切れに数えない）
//    ・音は、1秒ほどごとに、端末のファイルへ書き足す（途中でアプリが止まっても、そこまでの音は残る）
//    ・録音の情報（meta）は、10秒ごとに保存する
//    ・最長 60 分で、自動で止める。マイクが止まったとき（電話など）・書き込みに失敗したときも、そこまでを保存して終える

import { startPcmCapture } from "./pcmCapture";
import { LiveSpectrogram } from "./liveSpectrogram";
import { floatToInt16 } from "./base64";
import * as store from "./recordingStore";
import { getDeviceInfo } from "./deviceInfo";

export const MAX_RECORDING_SEC = 60 * 60;
const META_SAVE_MS = 10000;
const MAX_EVENTS = 200;
const PCM_MIN_COVERAGE = 0.98; // 無圧縮が、これ以上取れていれば、無圧縮を正式な録音にする（最初の音が届いてからの時間に対する割合）
const AAC_BITRATE = 256000;

const round1 = (v) => Math.round(v * 10) / 10;
const pad2 = (n) => String(n).padStart(2, "0");

// 例 2026-09-21T09:43:05+09:00（タイムゾーンつき）
export function isoWithOffset(date) {
  const off = -date.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  const abs = Math.abs(off);
  return (
    `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T` +
    `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}${sign}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`
  );
}

function chooseAacMime() {
  if (typeof MediaRecorder === "undefined") return null;
  return ["audio/mp4;codecs=mp4a.40.2", "audio/mp4"].find((t) => MediaRecorder.isTypeSupported?.(t)) ?? null;
}

// 録音を始める。マイクの許可が無い・マイクが使えないときは、例外（呼び出し側が、案内を出す）。
//   recorder：{ userId, name }／location：{ latitude, longitude, accuracyM, source, name }（無ければ、場所なし）
//   onEnded(meta, reason)：終わったとき（停止ボタン・自動で止まったとき）に、1回だけ呼ばれる
//   戻り値：操作の道具（controller）
export async function startRecording({ recorder, location, onEnded }) {
  const id = store.newId();
  const startedAtMs = Date.now();
  const meta = {
    version: 1,
    id,
    status: "recording", // recording（録音中・止まったまま残ったものも）／recorded（終わった）／error（書き込みに失敗）
    startedAt: isoWithOffset(new Date(startedAtMs)),
    startedAtMs,
    endedAt: null,
    durationSec: 0,
    recorder: { userId: recorder?.userId ?? null, name: recorder?.name ?? "" },
    device: getDeviceInfo(),
    audio: {
      sampleRate: null,
      channels: 1,
      master: null, // "pcm"（無圧縮）| "aac"（別の録音）。録音が終わったときに決まる
      inputLabel: null,
      constraints: null, // 実際に効いていた設定（エコー消しなど）
      pcm: { file: "audio.pcm", format: "s16le", samples: 0, seconds: 0, coverage: null },
      aac: { file: "audio.m4a", mime: null, bitrate: AAC_BITRATE, chunks: 0, bytes: 0, ok: true },
    },
    location: location ?? { latitude: null, longitude: null, accuracyM: null, source: "none", name: null },
    events: [], // 出来事（中断・再開など）
    interruptions: [], // 無圧縮が途切れた区間 { atSec, gapSec }
    network: { onlineAtStart: navigator.onLine },
    stopReason: null,
  };
  await store.createRecording(meta);

  const addEvent = (text) => {
    if (meta.events.length < MAX_EVENTS) meta.events.push(`${round1((Date.now() - startedAtMs) / 1000)}秒 ${text}`);
  };

  // 端末への書き込みは、順番に（直列に）行う。1つ失敗したら、録音を終える
  let chain = Promise.resolve();
  let writeError = null;
  const enqueue = (fn) => {
    chain = chain.then(fn).catch((err) => {
      console.error(err);
      if (!writeError) {
        writeError = err;
        addEvent(`端末に書き込めませんでした（${err?.message ?? err}）`);
        stop("端末に書き込めなかった");
      }
    });
    return chain;
  };

  let pcmSamples = 0;
  let aacChunks = 0;
  let aacBytes = 0;
  let lastWallMs = 0;
  let firstChunkAtMs = 0; // 最初の音が届いた時刻（割合は、ここから数える）
  let firstChunkSec = 0;
  let spec = null;
  const level = { rmsDb: -120, peakDb: -120 };
  const subscribers = new Set();
  let capStartMs = 0;
  let stopped = null; // stop() の結果（2回目以降の呼び出しに返す）

  let cap;
  try {
    cap = await startPcmCapture({
      onEvent: addEvent,
      onChunk: (chunk, info) => {
        if (!firstChunkAtMs) {
          firstChunkAtMs = Date.now();
          firstChunkSec = chunk.length / (cap?.sampleRate ?? 48000);
        }
        pcmSamples += chunk.length;
        const gapMs = info.wallMs - lastWallMs;
        lastWallMs = info.wallMs;
        if (gapMs > 1000) meta.interruptions.push({ atSec: round1((info.wallMs - gapMs) / 1000), gapSec: round1(gapMs / 1000) });
        if (!spec) spec = new LiveSpectrogram({ sampleRate: cap?.sampleRate ?? 48000 });
        spec.push(chunk);
        let sum = 0;
        let peak = 0;
        for (let i = 0; i < chunk.length; i++) {
          const v = chunk[i];
          sum += v * v;
          const a = v < 0 ? -v : v;
          if (a > peak) peak = a;
        }
        level.rmsDb = 20 * Math.log10(Math.sqrt(sum / chunk.length) + 1e-9);
        level.peakDb = 20 * Math.log10(peak + 1e-9);
        const i16 = floatToInt16(chunk);
        enqueue(() => store.appendBytes(id, "pcm", new Uint8Array(i16.buffer)));
        subscribers.forEach((fn) => fn(chunk, info));
      },
    });
  } catch (err) {
    await store.deleteRecording(id).catch(() => {}); // 始められなかった録音は、残さない
    throw err;
  }
  capStartMs = Date.now();
  meta.audio.sampleRate = cap.sampleRate;
  meta.audio.inputLabel = cap.trackLabel || null;
  meta.audio.constraints = { asked: cap.constraintsAsked, applied: cap.settings, mode: cap.mode };
  addEvent(`録音を始めた（${cap.mode}・${cap.sampleRate}Hz）`);

  // 別の録音（AAC）：画面を消しても続く保険
  let mr = null;
  const mime = chooseAacMime();
  if (mime) {
    try {
      mr = new MediaRecorder(cap.stream, { mimeType: mime, audioBitsPerSecond: AAC_BITRATE });
      mr.ondataavailable = (e) => {
        if (!e.data || !e.data.size) return;
        aacChunks += 1;
        const pending = e.data.arrayBuffer(); // 書き足す順番を守るため、変換は、順番待ちの中で待つ
        enqueue(async () => {
          const bytes = new Uint8Array(await pending);
          aacBytes += bytes.length;
          await store.appendBytes(id, "aac", bytes);
        });
      };
      mr.onerror = (e) => addEvent(`別の録音でエラー（${e?.error?.name ?? ""}）`);
      mr.start(1000);
      meta.audio.aac.mime = mr.mimeType || mime;
    } catch (err) {
      mr = null;
      meta.audio.aac.ok = false;
      addEvent(`別の録音（AAC）を始められませんでした（${err?.message ?? err}）`);
    }
  } else {
    meta.audio.aac.ok = false;
    addEvent("この端末は、別の録音（AAC）に対応していません");
  }

  // 画面を点けたままにする（取れれば）。画面が消えると外れるので、点いたときに取り直す。音の処理の再開も試みる
  let wake = null;
  const acquireWake = async () => {
    if (!("wakeLock" in navigator)) return;
    try {
      wake = await Promise.race([navigator.wakeLock.request("screen"), new Promise((_, rej) => setTimeout(() => rej(new Error("応答なし")), 3000))]);
    } catch {
      wake = null;
    }
  };
  acquireWake();
  const onVis = () => {
    addEvent(`画面が「${document.visibilityState === "hidden" ? "消えた" : "点いた"}」`);
    if (document.visibilityState === "visible") {
      cap.resume().then((st) => addEvent(`音の処理を再開しようとした → 状態「${st}」`));
      acquireWake();
    }
  };
  document.addEventListener("visibilitychange", onVis);

  // マイクが止まったとき（電話など）は、そこまでを保存して終える
  const track = cap.stream.getAudioTracks()[0];
  const onTrackEnded = () => stop("マイクが止まった（電話など）");
  track?.addEventListener("ended", onTrackEnded);

  // 10秒ごとに、録音の情報を保存する。最長時間で、自動で止める
  const snapshot = () => {
    const wallSec = (Date.now() - capStartMs) / 1000;
    meta.durationSec = round1(wallSec);
    meta.audio.pcm.samples = pcmSamples;
    meta.audio.pcm.seconds = round1(pcmSamples / cap.sampleRate);
    // 最初の音が届いてからの時間（最初のかたまりの長さを足す）に対する、取れた音の割合
    const activeSec = firstChunkAtMs ? (Date.now() - firstChunkAtMs) / 1000 + firstChunkSec : 0;
    meta.audio.pcm.coverage = activeSec > 0 ? Math.min(1, pcmSamples / cap.sampleRate / activeSec) : null;
    meta.audio.pcm.startupSec = firstChunkAtMs ? round1((firstChunkAtMs - capStartMs) / 1000) : null;
    meta.audio.aac.chunks = aacChunks;
    meta.audio.aac.bytes = aacBytes;
  };
  const timer = setInterval(() => {
    if (stopped) return;
    snapshot();
    enqueue(() => store.writeMeta(meta));
    if ((Date.now() - startedAtMs) / 1000 >= MAX_RECORDING_SEC) stop("最長の時間（60分）になった");
  }, META_SAVE_MS);
  enqueue(() => store.writeMeta(meta)); // 始めた直後にも、保存

  async function stop(reason = "停止ボタン") {
    if (stopped) return stopped;
    stopped = (async () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVis);
      track?.removeEventListener("ended", onTrackEnded);
      wake?.release?.().catch?.(() => {});
      if (mr && mr.state !== "inactive") {
        await new Promise((resolve) => {
          const t = setTimeout(resolve, 3000);
          mr.onstop = () => {
            clearTimeout(t);
            resolve();
          };
          try {
            mr.stop();
          } catch {
            clearTimeout(t);
            resolve();
          }
        });
      }
      await cap.stop();
      await chain; // 書き込みが、全部終わるのを待つ
      snapshot();
      const coverage = meta.audio.pcm.coverage ?? 0;
      meta.audio.master = coverage >= PCM_MIN_COVERAGE || !meta.audio.aac.ok || aacBytes === 0 ? "pcm" : "aac";
      meta.endedAt = isoWithOffset(new Date());
      meta.stopReason = reason;
      meta.status = writeError ? "error" : "recorded";
      addEvent(`録音を止めた（${reason}）`);
      await store.writeMeta(meta).catch((err) => console.error(err));
      onEnded?.(meta, reason);
      return meta;
    })();
    return stopped;
  }

  return {
    id,
    meta: () => meta,
    elapsedSec: () => (Date.now() - startedAtMs) / 1000,
    level: () => ({ ...level }),
    draw: (canvas) => spec?.draw(canvas),
    // 録音中の様子（画面に出す）
    status: () => {
      const activeSec = firstChunkAtMs ? (Date.now() - firstChunkAtMs) / 1000 + firstChunkSec : 0;
      const st = cap.trackState?.() ?? {};
      return {
        ctxState: st.ctxState, // iPhone は、画面を消すと "interrupted"（無圧縮が止まる。別の録音は続く）
        pcmCoverage: activeSec > 1 ? Math.min(1, pcmSamples / cap.sampleRate / activeSec) : 1,
        aacOk: meta.audio.aac.ok && !!mr && mr.state === "recording",
        aacBytes,
        writeError: !!writeError,
      };
    },
    setLocation: (loc) => {
      meta.location = loc;
    },
    onChunk: (fn) => {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
    stop,
  };
}
