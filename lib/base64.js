// バイト列（Uint8Array）→ base64 の文字列（端末のファイルに書き足すときに使う）。
// 大きな塊を一度に String.fromCharCode に渡すと、あふれるので、少しずつ変換する
export function bytesToBase64(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

// Float32（-1〜1）の音 → 16bit 整数（Int16）
export function floatToInt16(samples) {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i];
    out[i] = v >= 1 ? 32767 : v <= -1 ? -32768 : Math.round(v * 32767);
  }
  return out;
}
