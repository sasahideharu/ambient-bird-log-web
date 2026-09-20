// 🔥 波形を MP3 にする（編集画面で、加工した音を書き出すときに使う）。
//    ・モノラル → モノラル、ステレオ → ステレオ（左右を保つ）。ビットレートは、元の録音と同じ 192kbps
//    ・変換の部品：@breezystack/lamejs（LGPL-3.0。ブラウザの中だけで動く。音は、どこにも送られない）
//    ・長い音でも、画面が固まらないよう、途中で、少しずつ休みを入れる

import { Mp3Encoder } from "@breezystack/lamejs";

const KBPS = 192;
const BLOCK = 1152; // MP3 の1フレームの長さ（サンプル数）
const YIELD_EVERY_BLOCKS = 400; // これだけ変換するごとに、画面に処理を譲る

function toInt16(samples) {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const x = Math.max(-1, Math.min(1, samples[i]));
    out[i] = x < 0 ? x * 0x8000 : x * 0x7fff;
  }
  return out;
}

// channels：Float32Array の配列（1本＝モノラル、2本＝ステレオ）。sampleRate：32000・44100・48000 のいずれか
// 戻り値：MP3 の Blob
export async function encodeMp3(channels, sampleRate) {
  const list = Array.isArray(channels) ? channels : [channels];
  const numCh = Math.min(2, list.length);
  if (numCh === 0 || list[0].length === 0) throw new Error("音が空です");

  const encoder = new Mp3Encoder(numCh, sampleRate, KBPS);
  const left = toInt16(list[0]);
  const right = numCh === 2 ? toInt16(list[1]) : null;

  const parts = [];
  for (let i = 0, block = 0; i < left.length; i += BLOCK, block++) {
    const l = left.subarray(i, i + BLOCK);
    const chunk = right ? encoder.encodeBuffer(l, right.subarray(i, i + BLOCK)) : encoder.encodeBuffer(l);
    if (chunk.length > 0) parts.push(chunk.slice()); // 部品の内部の領域は、次の変換で上書きされるため、写しを取る
    if (block % YIELD_EVERY_BLOCKS === YIELD_EVERY_BLOCKS - 1) await new Promise((r) => setTimeout(r, 0));
  }
  const tail = encoder.flush();
  if (tail.length > 0) parts.push(tail.slice());
  return new Blob(parts, { type: "audio/mpeg" });
}
