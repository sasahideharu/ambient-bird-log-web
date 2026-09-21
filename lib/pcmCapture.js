// 🔥 マイクの音を、生のまま（PCM）取り出す部品（録音・リアルタイム表示・解析の土台）。
//    ・音の自動調整（ノイズ抑制・音量調整・エコー消し）は、切るように頼む。ただし、機種によっては、切れないことがある
//      （切れたかは、戻り値の settings〔実際に効いている設定〕で分かる）
//    ・取り出し方：AudioWorklet（新しい・軽い）。使えなければ ScriptProcessor（古いが、どこでも動く）
//    ・サンプルレートは、端末まかせ（多くは 48kHz か 44.1kHz）。戻り値の sampleRate に入る
//    onChunk(Float32Array, info)：音のかたまり（約 2048 サンプル）ごとに呼ばれる。info＝{ sampleCount（ここまでの合計）, wallMs（開始からの実時間）}

const WORKLET_CODE = `
class PcmTap extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(2048);
    this.n = 0;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch && ch.length) {
      for (let i = 0; i < ch.length; i++) {
        this.buf[this.n++] = ch[i];
        if (this.n === this.buf.length) {
          this.port.postMessage(this.buf.slice(0));
          this.n = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor("pcm-tap", PcmTap);
`;

// 使えるか（画面に出す診断用）
export function captureSupport() {
  const md = typeof navigator !== "undefined" ? navigator.mediaDevices : null;
  return {
    secureContext: typeof window !== "undefined" ? window.isSecureContext : false,
    getUserMedia: !!md?.getUserMedia,
    audioContext: typeof window !== "undefined" && !!(window.AudioContext || window.webkitAudioContext),
    audioWorklet: typeof window !== "undefined" && !!window.AudioContext && "audioWorklet" in window.AudioContext.prototype,
    mediaRecorder: typeof window !== "undefined" && typeof window.MediaRecorder !== "undefined",
  };
}

// 録音を始める（マイクの許可を、ここで求める）。戻り値：{ mode, sampleRate, settings, constraintsAsked, stop() }
export async function startPcmCapture({ onChunk, preferWorklet = true }) {
  const md = navigator.mediaDevices;
  if (!md?.getUserMedia) {
    throw new Error("この環境では、マイクを使えません（getUserMedia がありません）。安全な接続でないか、この端末が対応していません");
  }
  const constraintsAsked = { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 };
  const stream = await md.getUserMedia({ audio: constraintsAsked, video: false });
  const track = stream.getAudioTracks()[0];
  const settings = track?.getSettings ? track.getSettings() : {};

  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  const ctx = new AudioCtx();
  if (ctx.state === "suspended") await ctx.resume();
  const source = ctx.createMediaStreamSource(stream);

  const startedAt = performance.now();
  let sampleCount = 0;
  const deliver = (chunk) => {
    sampleCount += chunk.length;
    onChunk?.(chunk, { sampleCount, wallMs: performance.now() - startedAt });
  };

  let node = null;
  let mode = null;
  if (preferWorklet && ctx.audioWorklet) {
    try {
      const url = URL.createObjectURL(new Blob([WORKLET_CODE], { type: "application/javascript" }));
      try {
        await ctx.audioWorklet.addModule(url);
      } finally {
        URL.revokeObjectURL(url);
      }
      node = new AudioWorkletNode(ctx, "pcm-tap", { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1 });
      node.port.onmessage = (e) => deliver(e.data);
      mode = "AudioWorklet";
    } catch (err) {
      console.warn("AudioWorklet を使えません。ScriptProcessor に切り替えます", err);
      node = null;
    }
  }
  if (!node) {
    node = ctx.createScriptProcessor(2048, 1, 1);
    node.onaudioprocess = (e) => deliver(new Float32Array(e.inputBuffer.getChannelData(0)));
    mode = "ScriptProcessor";
  }

  // 出力につなぐ（つながないと、動かない実装がある）。音は出さない（音量0）
  const mute = ctx.createGain();
  mute.gain.value = 0;
  source.connect(node);
  node.connect(mute);
  mute.connect(ctx.destination);

  return {
    mode,
    sampleRate: ctx.sampleRate,
    settings,
    constraintsAsked,
    trackLabel: track?.label ?? "",
    trackState: () => ({ readyState: track?.readyState, muted: track?.muted, ctxState: ctx.state }),
    async stop() {
      try {
        node.disconnect();
        source.disconnect();
        mute.disconnect();
      } catch {
        // すでに切れている
      }
      if (node.port) node.port.onmessage = null;
      stream.getTracks().forEach((t) => t.stop());
      try {
        await ctx.close();
      } catch {
        // すでに閉じている
      }
    },
  };
}
