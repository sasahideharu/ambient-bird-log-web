// 🔥 レコードのように、音を「ずらす」・逆再生する・遅く再生するプレーヤー（3D の拡大表示用）。
//    ・ずらす（scrub）：スライダーを動かした位置（目標）を、音の位置が、少し遅れて追いかける。追いかける速さが、そのまま、再生の速さになる
//      → 速くずらせば、速く（高い音）。ゆっくりずらせば、ゆっくり（低い音）。戻せば、逆再生。止めれば、無音（レコードを止めた状態）
//    ・再生する（play）：向き（順・逆）と速さ（0.05〜1倍）を決めて、進める。遅くするほど、音は低くなる（レコードの回転を遅くしたときと同じ）
//    ・音は、Web Audio の AudioWorklet で、1サンプルずつ、位置をずらしながら読む（直線でつなぐ）。速さが変わるとき、プチっと鳴らないよう、なめらかに変える
//    ・iPhone：Web Audio は、既定では、消音スイッチで、鳴らなくなる。navigator.audioSession.type = "playback"（iOS 16.4〜）で、鳴らす（未対応の古い iOS では、消音スイッチが優先される）
//    ・AudioContext は、初めて使うとき（スライダーに触ったとき）に作る（ページを開いただけでは、作らない＝ふつうの再生の、音の出方に影響しないように）

const MAX_SPEED = 6; // 再生の速さの上限（1＝ふつう）
const FOLLOW = 24; // 目標との差を、1秒に何回ぶん追いかけるか（大きいほど、指に、すぐ付いてくる）
const SMOOTH = 0.004; // 速さの、なめらかさ（小さいほど、なめらか。約5ミリ秒）
const MAX_RANGE_SEC = 600; // これより長い範囲は、メモリを使いすぎるので、使わない

const WORKLET_CODE = `
const MAX_SPEED = ${MAX_SPEED};
const FOLLOW = ${FOLLOW};
const SMOOTH = ${SMOOTH};
class ScrubPlayer extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ch = null;
    this.len = 0;
    this.bufRate = 48000;
    this.pos = 0;
    this.target = 0;
    this.vel = 0;
    this.mode = "follow"; // "follow"＝スライダーの位置を追いかける（ずらす）／"play"＝一定の速さで進む（順・逆）
    this.rate = 0; // play のときの速さ（負＝逆。1＝ふつう）
    this.on = false;
    this.stopping = false;
    this.fade = 0;
    this.count = 0;
    this.sumSq = 0;
    this.port.onmessage = (e) => {
      const m = e.data;
      if (m.type === "load") {
        this.ch = m.channels;
        this.len = m.channels[0].length;
        this.bufRate = m.sampleRate;
      } else if (m.type === "start") {
        this.mode = "follow";
        this.pos = this.target = Math.max(0, Math.min(this.len - 1, m.pos * this.bufRate));
        this.vel = 0;
        this.fade = 0;
        this.on = true;
        this.stopping = false;
      } else if (m.type === "play") {
        this.mode = "play";
        this.rate = m.rate;
        this.pos = Math.max(0, Math.min(this.len - 1, m.pos * this.bufRate));
        this.vel = 0;
        this.fade = 0;
        this.on = true;
        this.stopping = false;
      } else if (m.type === "rate") {
        this.rate = m.rate;
      } else if (m.type === "target") {
        this.target = Math.max(0, Math.min(this.len - 1, m.pos * this.bufRate));
      } else if (m.type === "stop") {
        this.stopping = true;
      }
    };
  }
  process(inputs, outputs) {
    const out = outputs[0];
    const n = out[0].length;
    if (!this.ch || !this.on) return true;
    const dt = 1 / sampleRate;
    const maxV = MAX_SPEED * this.bufRate;
    const fadeStep = 1 / (0.02 * sampleRate);
    for (let i = 0; i < n; i++) {
      let v = this.mode === "play" ? this.rate * this.bufRate : (this.target - this.pos) * FOLLOW;
      if (v > maxV) v = maxV;
      else if (v < -maxV) v = -maxV;
      this.vel += (v - this.vel) * SMOOTH;
      this.pos += this.vel * dt;
      if (this.pos < 0 || this.pos > this.len - 1) {
        this.pos = this.pos < 0 ? 0 : this.len - 1;
        this.vel = 0;
        if (this.mode === "play" && !this.stopping) {
          // 端まで来た：音を消して、知らせる
          this.stopping = true;
          this.port.postMessage({ ended: true, pos: this.pos / this.bufRate });
        }
      }
      if (this.stopping) {
        this.fade -= fadeStep;
        if (this.fade <= 0) {
          this.fade = 0;
          this.on = false;
          this.stopping = false;
        }
      } else if (this.fade < 1) {
        this.fade = Math.min(1, this.fade + fadeStep);
      }
      // ほとんど止まっているときは、音を消す（同じ1点の値が、ずっと出続けて、ノイズになるのを防ぐ）
      const speed = Math.abs(this.vel) / this.bufRate;
      const g = (this.mode === "play" ? 1 : Math.min(1, speed * 6)) * this.fade * 0.9; // 進めるときは、遅くても、音を消さない
      const ip = this.pos | 0;
      const f = this.pos - ip;
      for (let c = 0; c < out.length; c++) {
        const b = this.ch[c < this.ch.length ? c : 0];
        const a0 = b[ip];
        const a1 = ip + 1 < this.len ? b[ip + 1] : a0;
        const s = (a0 + (a1 - a0) * f) * g;
        out[c][i] = s;
        if (c === 0) this.sumSq += s * s;
      }
    }
    this.count += n;
    if (this.count >= 2048) {
      this.port.postMessage({ pos: this.pos / this.bufRate, speed: this.vel / this.bufRate, level: Math.sqrt(this.sumSq / this.count) });
      this.count = 0;
      this.sumSq = 0;
    }
    return true; // false を返すと、二度と動かなくなるので、止まっているときも、true
  }
}
registerProcessor("scrub-player", ScrubPlayer);
`;

// 使えるか（AudioWorklet が要る）
export function scrubSupported() {
  return typeof window !== "undefined" && !!window.AudioContext && "audioWorklet" in window.AudioContext.prototype;
}

export function createScrubPlayer() {
  let ctx = null;
  let node = null;
  let pendingLoad = null; // { channels, sampleRate }（まだ、ノードが無いときの、預かり）
  let loaded = false;
  let starting = null;
  let lastT = 0; // 最後に伝えられた、目標の位置（開始の準備中に、指が動いたとき用）
  let disposed = false;
  const stats = { pos: 0, speed: 0, level: 0, at: 0, ended: false };
  let duration = 0; // 読み込んだ音の長さ（秒）

  async function ensureNode() {
    if (disposed) throw new Error("閉じています");
    if (!ctx) {
      try {
        if (navigator.audioSession) navigator.audioSession.type = "playback"; // iPhone：消音スイッチでも鳴らす
      } catch {
        // 対応していない環境
      }
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      ctx = new AudioCtx();
    }
    if (ctx.state === "suspended") await ctx.resume();
    if (!node) {
      const url = URL.createObjectURL(new Blob([WORKLET_CODE], { type: "application/javascript" }));
      try {
        await ctx.audioWorklet.addModule(url);
      } finally {
        URL.revokeObjectURL(url);
      }
      if (disposed) return;
      node = new AudioWorkletNode(ctx, "scrub-player", { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
      node.port.onmessage = (e) => {
        Object.assign(stats, e.data);
        stats.at = performance.now();
      };
      node.connect(ctx.destination);
      if (pendingLoad) {
        const { channels, sampleRate } = pendingLoad;
        node.port.postMessage({ type: "load", channels, sampleRate }, channels.map((c) => c.buffer));
        pendingLoad = null;
      }
    }
  }

  return {
    // 音（範囲の、左右のサンプル）を渡す。channels：Float32Array の配列（1〜2本）／sampleRate
    load(channels, sampleRate) {
      loaded = true;
      duration = channels[0].length / sampleRate;
      if (node) node.port.postMessage({ type: "load", channels, sampleRate }, channels.map((c) => c.buffer));
      else pendingLoad = { channels, sampleRate };
    },
    isLoaded: () => loaded,
    // ずらし始める（tSec：範囲の中の位置〔秒〕）。ユーザーの操作（スライダーに触った）の中で、呼ぶ
    async start(tSec) {
      lastT = tSec;
      const p = ensureNode().then(() => {
        if (!node || !loaded) return false;
        node.port.postMessage({ type: "start", pos: tSec });
        if (lastT !== tSec) node.port.postMessage({ type: "target", pos: lastT }); // 準備のあいだに、動いた分
        return true;
      });
      starting = p;
      return p;
    },
    // 進める（tSec：範囲の中の位置〔秒〕・rate：速さ。負なら逆再生。1＝ふつう）。ユーザーの操作の中で、呼ぶ。準備できなければ false
    async play(tSec, rate) {
      lastT = tSec;
      stats.ended = false;
      stats.pos = tSec;
      stats.speed = 0;
      stats.at = performance.now();
      const p = ensureNode().then(() => {
        if (!node || !loaded) return false;
        node.port.postMessage({ type: "play", pos: tSec, rate });
        return true;
      });
      starting = p;
      return p;
    },
    // 進めている途中で、速さ・向きを変える
    setRate(rate) {
      if (node) node.port.postMessage({ type: "rate", rate });
    },
    // いまの位置（秒）。メッセージの間は、速さから、割り出す（なめらかに動かすため）
    getPos() {
      const dtSec = (performance.now() - stats.at) / 1000;
      const p = stats.pos + stats.speed * Math.min(dtSec, 0.2);
      return Math.max(0, Math.min(duration, p));
    },
    // 目標の位置（スライダーの位置）を、伝える
    move(tSec) {
      lastT = tSec;
      if (node) node.port.postMessage({ type: "target", pos: tSec });
    },
    // ずらし終わる（音は、20ミリ秒で、消える）
    stop() {
      starting?.then(() => node?.port.postMessage({ type: "stop" })).catch(() => {});
    },
    stats,
    dispose() {
      disposed = true;
      try {
        node?.disconnect();
      } catch {
        // すでに切れている
      }
      node = null;
      ctx?.close?.().catch(() => {});
      if (ctx) {
        try {
          if (navigator.audioSession) navigator.audioSession.type = "auto"; // 元に戻す（録音など、ほかの音の使い方の、じゃまをしないように）
        } catch {
          // 対応していない環境
        }
      }
      ctx = null;
    },
  };
}

export { MAX_RANGE_SEC };
