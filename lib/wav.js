// 🔥 波形（Float32Array・モノラル）を、WAV（16ビットの整数）にする。
//    編集画面で、加工した音を <audio> で再生するために使う。
//    （Web Audio で鳴らすと、iPhone の消音スイッチで無音になる。<audio> なら、他の再生と同じように鳴る）
export function encodeWav(samples, sampleRate) {
  const n = samples.length;
  const buffer = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buffer);
  const writeText = (offset, text) => {
    for (let i = 0; i < text.length; i++) v.setUint8(offset + i, text.charCodeAt(i));
  };
  writeText(0, "RIFF");
  v.setUint32(4, 36 + n * 2, true);
  writeText(8, "WAVE");
  writeText(12, "fmt ");
  v.setUint32(16, 16, true); // fmt の長さ
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // モノラル
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  writeText(36, "data");
  v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const x = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, x < 0 ? x * 0x8000 : x * 0x7fff, true);
  }
  return new Blob([buffer], { type: "audio/wav" });
}
