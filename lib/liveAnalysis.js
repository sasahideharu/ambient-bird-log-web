// 🔥 録音しながらの解析（リアルタイム）。録音の音を、3秒ごとに、「その時点までの最後の5秒」を MP3 にして、解析サーバー（/live）へ送る。
//    ・BirdNET は最後の3秒、Perch は最後の5秒を解析して、返ってくる（サーバーは何も保存しない）
//    ・音は、録音の始めから数えて 3秒の倍数の位置で区切る（あとで、録音を丸ごと解析したときの3秒の区間と、そろう）
//    ・送る音の形は、下見の試験で決めた：MP3・モノラル・192kbps（48kHz か 44.1kHz のまま）。MP3 の符号化の遅れは、サーバーが捨てる
//      （遅れを捨てないと、BirdNET が3割ほど見落とす）。サーバーには、符号化した元のサンプル数も伝える
//    ・同時に送るのは1回だけ。前の回が終わっていなければ、その区間は飛ばす。電波が無いとき・失敗が続くときは、間をあけて、やり直す
//    ・録音そのもの（端末への保存）には、影響しない。失敗しても、録音は続く

import { Mp3Encoder } from "@breezystack/lamejs";
import { supabase, SUPABASE_PUBLIC_KEY } from "./supabaseClient";
import { ANALYZER_URL } from "./analyzerConfig";

export const LIVE_STEP_SEC = 3;
export const LIVE_WINDOW_SEC = 5;
const KBPS = 192;
const BLOCK = 1152; // MP3 の1フレームの長さ（サンプル数）
const SLICE_MS = 10; // 1回に続けて変換する時間の上限。これを超えたら、画面に処理を譲る（スペクトログラムの動きを止めないため）
const REQUEST_TIMEOUT_MS = 30000; // 起こす（初回）だけで約20秒かかる
const WARM_TIMEOUT_MS = 60000;
const CODEC_RATES = [32000, 44100, 48000];
const AUTH_STOP_STATUSES = [401, 403];

// BirdNET の週（1〜48。1か月を4週）。サーバーの week_from_filename と同じ数え方
export function birdnetWeek(date = new Date()) {
  return date.getMonth() * 4 + Math.min(4, Math.floor((date.getDate() - 1) / 7) + 1);
}

async function authHeaders() {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) throw Object.assign(new Error("ログインが必要です"), { status: 401 });
  return { Authorization: `Bearer ${token}`, apikey: SUPABASE_PUBLIC_KEY };
}

// 録音の画面を開いたときに呼ぶ。解析サーバーを、先に起こして、この場所・週の準備と、ダミーの解析まで済ませておく
// （終わるまで待つ。起こすところからだと約25秒）。location：{ latitude, longitude } か null。戻り値：準備できたら true
export async function warmLiveServer(location) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), WARM_TIMEOUT_MS);
  try {
    const q = new URLSearchParams({ week: String(birdnetWeek()) });
    if (location && location.latitude != null && location.longitude != null) {
      q.set("lat", Number(location.latitude).toFixed(5));
      q.set("lon", Number(location.longitude).toFixed(5));
    }
    const res = await fetch(`${ANALYZER_URL}/live/warm?${q}`, { method: "POST", headers: await authHeaders(), signal: ctrl.signal });
    return res.ok;
  } catch (err) {
    console.error(err);
    return false;
  } finally {
    clearTimeout(timer);
  }
}

// 画面に処理を譲る。setTimeout は、画面が隠れているときなどに、1秒ごとにしか動かなくなることがあるので、MessageChannel を使う
function yieldToScreen() {
  return new Promise((resolve) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => {
      ch.port1.close();
      resolve();
    };
    ch.port2.postMessage(0);
  });
}

// Float32 の音 → MP3（Uint8Array）。長いあいだ画面を固めないよう、10ミリ秒ごとに、休みを入れる
async function encodeMp3Bytes(int16, sampleRate) {
  const encoder = new Mp3Encoder(1, sampleRate, KBPS);
  const parts = [];
  let size = 0;
  let sliceStart = performance.now();
  for (let i = 0; i < int16.length; i += BLOCK) {
    const chunk = encoder.encodeBuffer(int16.subarray(i, i + BLOCK));
    if (chunk.length > 0) {
      parts.push(chunk.slice()); // 部品の内部の領域は、次の変換で上書きされるため、写しを取る
      size += chunk.length;
    }
    if (performance.now() - sliceStart > SLICE_MS) {
      await yieldToScreen();
      sliceStart = performance.now();
    }
  }
  const tail = encoder.flush();
  if (tail.length > 0) {
    parts.push(tail.slice());
    size += tail.length;
  }
  const out = new Uint8Array(size);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

function toInt16(samples) {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i];
    out[i] = v >= 1 ? 32767 : v <= -1 ? -32768 : Math.round(v * 32767);
  }
  return out;
}

// 48kHz・44.1kHz・32kHz 以外のときだけ使う。直線でつないで、48kHz にする（鳥の声の高さの範囲では、十分）
function resampleTo48k(samples, fromRate) {
  const n = Math.round((samples.length * 48000) / fromRate);
  const out = new Float32Array(n);
  const ratio = fromRate / 48000;
  for (let i = 0; i < n; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(samples.length - 1, i0 + 1);
    const f = pos - i0;
    out[i] = samples[i0] * (1 - f) + samples[i1] * f;
  }
  return out;
}

// 🔥 エンジンをつくる。
//    getLocation()：{ latitude, longitude } か null（毎回、呼ばれる）／isEnabled()：false の間は、送らない
//    onResult({ endSec, bn: { t0, t1, species }, pc: { t0, t1, top } | null, latencySec })：結果が返るごと（時刻は、録音の始めからの秒）
//    onState({ status, message, sent, ok, failed, skipped, latencySec })
//      status：idle（まだ）／working（解析中）／ok／slow（返事が遅い）／offline（電波なし）／error／auth（ログインが切れた）／off（切）
//    push(chunk, info)：録音の音のかたまりを渡す（info.sampleRate）。stop()：終わる
export function createLiveAnalysis({ getLocation, isEnabled = () => true, onResult, onState }) {
  let sampleRate = 0;
  let ring = null;
  let written = 0; // ここまでの合計サンプル数（音が届いた分だけ数える）
  let nextTick = 1; // 次に送る区間の番号（k番目＝録音の始めから 3×k 秒まで）
  let inflight = false;
  let backoffTicks = 0;
  let failures = 0;
  let stopped = false;
  let authLost = false;
  let firstRequest = true;
  let pendingK = null; // 前の回が終わっていなくて、飛ばした区間（あとで、まだ間に合えば、終わった直後に送る）
  const stats = { status: "idle", message: "", sent: 0, ok: 0, failed: 0, skipped: 0, latencySec: null, encodeSec: null, fetchSec: null, serverSec: null };

  const emit = (patch) => {
    Object.assign(stats, patch);
    onState?.({ ...stats });
  };

  async function send(endSample) {
    const srcRate = sampleRate;
    const winSamples = Math.round(LIVE_WINDOW_SEC * srcRate);
    const startSample = Math.max(0, endSample - winSamples);
    const n = endSample - startSample;
    const cap = ring.length;
    const seg = new Float32Array(n);
    for (let i = 0; i < n; i++) seg[i] = ring[(startSample + i) % cap];

    let codecRate = srcRate;
    let pcm = seg;
    if (!CODEC_RATES.includes(srcRate)) {
      codecRate = 48000;
      pcm = resampleTo48k(seg, srcRate);
    }
    const t0 = performance.now();
    inflight = true;
    stats.sent += 1;
    emit({ status: firstRequest ? "working" : stats.status });
    try {
      const mp3 = await encodeMp3Bytes(toInt16(pcm), codecRate);
      const tEncoded = performance.now();
      const loc = getLocation?.();
      const q = new URLSearchParams({ codec_rate: String(codecRate), samples: String(pcm.length), week: String(birdnetWeek()) });
      if (loc && loc.latitude != null && loc.longitude != null) {
        q.set("lat", Number(loc.latitude).toFixed(5));
        q.set("lon", Number(loc.longitude).toFixed(5));
      }
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
      let res;
      try {
        res = await fetch(`${ANALYZER_URL}/live?${q}`, {
          method: "POST",
          headers: { ...(await authHeaders()), "Content-Type": "audio/mpeg" },
          body: mp3,
          signal: ctrl.signal,
        });
      } finally {
        clearTimeout(timer);
      }
      if (!res.ok) throw Object.assign(new Error(`サーバーがエラーを返しました（${res.status}）`), { status: res.status });
      const body = await res.json();
      if (!body.ok) throw new Error(body.error || "解析できませんでした");
      const latencySec = (performance.now() - t0) / 1000;
      const offset = startSample / srcRate; // 送った音の始まり（録音の始めからの秒）
      const bw = body.birdnet?.windows?.[0];
      const pw = body.perch?.windows?.[0];
      failures = 0;
      firstRequest = false;
      stats.ok += 1;
      const r1 = (v) => Math.round(v * 10) / 10;
      emit({
        status: latencySec > 6 ? "slow" : "ok",
        message: "",
        latencySec: r1(latencySec),
        encodeSec: r1((tEncoded - t0) / 1000),
        fetchSec: r1((performance.now() - tEncoded) / 1000),
        serverSec: body.elapsed_sec != null ? r1(body.elapsed_sec) : null,
      });
      if (!stopped) {
        onResult?.({
          endSec: endSample / srcRate,
          bn: bw ? { t0: offset + bw.t0, t1: offset + bw.t1, species: bw.species ?? [] } : null,
          pc: pw ? { t0: offset + pw.t0, t1: offset + pw.t1, top: pw.top ?? [] } : null,
          latencySec,
        });
      }
    } catch (err) {
      failures += 1;
      stats.failed += 1;
      if (AUTH_STOP_STATUSES.includes(err?.status)) {
        authLost = true;
        emit({ status: "auth", message: "ログインが切れました。ログインし直すと、解析が使えます（録音は続いています）" });
      } else {
        backoffTicks = Math.min(failures, 4); // 失敗が続くほど、間をあける（最大 12秒）
        const aborted = err?.name === "AbortError";
        emit({
          status: navigator.onLine === false ? "offline" : "error",
          message: aborted ? "解析サーバーの返事が、遅すぎました" : err?.status ? err.message : "解析サーバーにつながりませんでした",
        });
        console.error(err);
      }
    } finally {
      inflight = false;
      // 遅れて、飛ばした区間があれば、終わった直後に送る（音は、まだ8秒ぶんの入れ物に残っている間だけ）
      if (pendingK != null && !stopped) {
        const k = pendingK;
        pendingK = null;
        if (written - Math.round(k * LIVE_STEP_SEC * sampleRate) <= 2.5 * sampleRate) tick(k);
        else stats.skipped += 1;
      }
    }
  }

  function tick(k) {
    if (stopped || authLost) return;
    if (!isEnabled()) {
      if (stats.status !== "off") emit({ status: "off", message: "" });
      return;
    }
    if (navigator.onLine === false) {
      stats.skipped += 1;
      emit({ status: "offline", message: "電波なし：録音だけ続けます（あとで解析できます）" });
      return;
    }
    if (inflight) {
      if (pendingK != null) stats.skipped += 1; // 前に飛ばした区間は、もう間に合わない
      pendingK = k;
      return;
    }
    if (backoffTicks > 0) {
      backoffTicks -= 1;
      stats.skipped += 1;
      return;
    }
    send(Math.round(k * LIVE_STEP_SEC * sampleRate));
  }

  return {
    push(chunk, info) {
      if (stopped) return;
      if (!ring) {
        if (!info?.sampleRate) return; // サンプルレートが分かるまでは、受け取らない
        sampleRate = info.sampleRate;
        ring = new Float32Array(Math.round(8 * sampleRate)); // 5秒＋余裕
      }
      const cap = ring.length;
      let pos = written % cap;
      for (let i = 0; i < chunk.length; i++) {
        ring[pos] = chunk[i];
        pos = pos + 1 === cap ? 0 : pos + 1;
      }
      written += chunk.length;
      while (written >= Math.round(nextTick * LIVE_STEP_SEC * sampleRate)) {
        tick(nextTick);
        nextTick += 1;
      }
    },
    stats: () => ({ ...stats }),
    stop() {
      stopped = true;
    },
  };
}
