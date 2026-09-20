// 🔥 波形を、WAV（16ビットの整数）にする。
//    編集画面で、加工した音を <audio> で再生するために使う。
//    （Web Audio で鳴らすと、iPhone の消音スイッチで無音になる。<audio> なら、他の再生と同じように鳴る）
//    channels：Float32Array（モノラル）か、Float32Array の配列（ステレオなら2本）
export function encodeWav(channels, sampleRate) {
  const list = Array.isArray(channels) ? channels : [channels];
  const ch = list.length;
  const n = list[0].length;
  const buffer = new ArrayBuffer(44 + n * ch * 2);
  const v = new DataView(buffer);
  const writeText = (offset, text) => {
    for (let i = 0; i < text.length; i++) v.setUint8(offset + i, text.charCodeAt(i));
  };
  writeText(0, "RIFF");
  v.setUint32(4, 36 + n * ch * 2, true);
  writeText(8, "WAVE");
  writeText(12, "fmt ");
  v.setUint32(16, 16, true); // fmt の長さ
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, ch, true); // チャンネル数
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * ch * 2, true);
  v.setUint16(32, ch * 2, true);
  v.setUint16(34, 16, true);
  writeText(36, "data");
  v.setUint32(40, n * ch * 2, true);
  let offset = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < ch; c++) {
      const x = Math.max(-1, Math.min(1, list[c][i]));
      v.setInt16(offset, x < 0 ? x * 0x8000 : x * 0x7fff, true);
      offset += 2;
    }
  }
  return new Blob([buffer], { type: "audio/wav" });
}
