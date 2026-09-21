// 🔥 画面を消しても、録音の音の処理が中断されないようにするための工夫（実験用）。
//    iPhone は、画面を消すと、音の処理（AudioContext）を「中断」する（下見の結果：録音が約13秒とぎれた）。
//    「音を再生している」アプリは、裏でも、音の処理が続くので、無音の音声を、裏で流しておく。
//    ・startSilentAudio()：無音の音声（audio 要素）を、くり返し再生する。iPhone の「再生中」の表示（ロック画面）に、録音中と出す。
//      ※ ボタンを押した、その場（await の前）で呼ぶこと（iPhone は、ユーザーの操作の直後でないと、再生を許さない）

// 1秒ぶんの無音（8kHz・8bit・モノラル）の WAV
function silentWavUrl() {
  const rate = 8000;
  const n = rate; // 1秒
  const bytes = new Uint8Array(44 + n);
  const dv = new DataView(bytes.buffer);
  const text = (o, s) => [...s].forEach((c, i) => bytes.set([c.charCodeAt(0)], o + i));
  text(0, "RIFF");
  dv.setUint32(4, 36 + n, true);
  text(8, "WAVE");
  text(12, "fmt ");
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true); // PCM
  dv.setUint16(22, 1, true); // モノラル
  dv.setUint32(24, rate, true);
  dv.setUint32(28, rate, true); // バイト/秒
  dv.setUint16(32, 1, true);
  dv.setUint16(34, 8, true);
  text(36, "data");
  dv.setUint32(40, n, true);
  bytes.fill(0x80, 44); // 8bit の無音は 0x80
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return `data:audio/wav;base64,${btoa(bin)}`;
}

export function startSilentAudio() {
  const audio = new Audio(silentWavUrl());
  audio.loop = true;
  audio.setAttribute("playsinline", "");
  audio.volume = 1;
  const played = audio.play().then(
    () => "再生できた",
    (err) => `再生できなかった（${err?.name ?? ""} ${err?.message ?? err}）`
  );
  try {
    if ("mediaSession" in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({ title: "録音中", artist: "Ambient Bird Log" });
      navigator.mediaSession.playbackState = "playing";
    }
  } catch {
    // 使えない環境
  }
  return {
    played, // Promise：再生できたか（文字）
    stop() {
      try {
        audio.pause();
        audio.src = "";
        if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "none";
      } catch {
        // すでに止まっている
      }
    },
  };
}
