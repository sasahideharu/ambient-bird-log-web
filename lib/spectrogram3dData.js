import { computeSpectrogram, normalizeFrames } from "./spectrogram";
import { assertAudioResponse } from "./audioResponse";

const MAX_FREQ_HZ = 13500; // スペクトログラムの上限（AudioSpectrogramCard・AudioEditor と同じ）
const MIN_SAMPLES = 4096; // これより短いと、3D にできない
const MAX_PCM_SEC = 600; // ずらして聞ける範囲の長さの上限（メモリを使いすぎないように）
const CACHE_LIMIT = 12; // 覚えておく録音の数（多すぎるとメモリを使うので、古いものから捨てる）

// 録音（の指定した範囲）を読み込んで（デコードして）、左右のサンプルにする
async function decodeRange(src, startSec, endSec) {
  const res = await fetch(src);
  assertAudioResponse(res); // iPhone アプリの、端末に保存した音声（status 0）も許す
  const bytes = await res.arrayBuffer();
  // 読み込み（デコード）だけに使う。本物の AudioContext は、iPhone の音の出方（消音スイッチ）に影響するため、使わない
  const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const buf = await new Promise((resolve, reject) => new Offline(1, 1, 48000).decodeAudioData(bytes, resolve, reject));
  const sr = buf.sampleRate;
  const total = buf.length;
  const s = Math.min(Math.max(0, Math.floor((startSec ?? 0) * sr)), total - 1);
  const e = Math.min(total, Math.max(s + 1, Math.floor((endSec ?? buf.duration) * sr)));
  const n = e - s;
  if (n < MIN_SAMPLES) throw new Error("範囲が短すぎて、3Dにできません");

  const channelCount = Math.min(2, buf.numberOfChannels);
  const chans = [];
  for (let c = 0; c < channelCount; c++) chans.push(buf.getChannelData(c).slice(s, e));
  return { chans, sr, n, channelCount };
}

// 録音（の指定した範囲）を読み込んで、左右それぞれのスペクトログラム（時間×周波数・0〜1）にする。
// カード・編集画面と同じ計算（左右に、共通の明るさの基準）。時間の細かさは、画面の細かさに見合う約320列にする
async function computeData(src, startSec, endSec) {
  const { chans, sr, n, channelCount } = await decodeRange(src, startSec, endSec);

  let hop = Math.max(256, Math.ceil(n / 320 / 64) * 64);
  let fftSize = hop > 4096 ? 8192 : hop > 2048 ? 4096 : 2048; // 時間の間隔（hop）が長いときは、窓も長くして、音を取りこぼさない
  if (n < fftSize + hop * 8) {
    fftSize = 2048;
    hop = Math.max(64, Math.floor((n - fftSize) / 8));
  }
  const specs = chans.map((ch) => computeSpectrogram(ch, { fftSize, hop, bins: 128, sampleRate: sr, maxFreqHz: MAX_FREQ_HZ }));
  const sharedMaxDb = Math.max(...specs.map((sp) => sp.maxDb));
  const perChannel = specs.map((sp) => normalizeFrames(sp.rawFrames, sharedMaxDb));
  const T = perChannel[0].length;
  const B = perChannel[0][0].length;
  const flat = (rows) => {
    const a = new Float32Array(T * B);
    rows.forEach((row, t) => a.set(row, t * B));
    return a;
  };
  const left = flat(perChannel[0]);
  return {
    left,
    right: channelCount === 2 ? flat(perChannel[1]) : left, // モノラルは、左右を同じにする
    frames: T,
    bins: B,
    duration: n / sr,
    topHz: specs[0].topHz,
    channels: channelCount,
  };
}

// 再生位置のスライダーを、手でずらしたとき、レコードのように鳴らすための音（録音の指定した範囲の、左右のサンプル）。
// 覚えない（長い録音では、メモリを使うため。使うのは、1つの画面だけ）。戻り値：{ channels: Float32Array の配列, sampleRate, duration }
export async function loadPcm(src, startSec, endSec) {
  const { chans, sr, n } = await decodeRange(src, startSec, endSec);
  if (n / sr > MAX_PCM_SEC) throw new Error("範囲が長いので、ずらして聞くことは、できません");
  return { channels: chans, sampleRate: sr, duration: n / sr };
}

// 読み込み済みの録音を、少しだけ覚えておく（スクロールで戻ってきたとき・「大きく見る」で開いたときに、速く出す）。
// 保存しているのは、約束（Promise）。失敗したものは、覚えない
const cache = new Map();

export function loadSpectrogram(src, startSec, endSec) {
  const key = `${src}|${startSec ?? ""}|${endSec ?? ""}`;
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key); // 使ったものを、いちばん新しい位置へ
    cache.set(key, hit);
    return hit;
  }
  const p = computeData(src, startSec, endSec);
  cache.set(key, p);
  p.catch(() => {
    if (cache.get(key) === p) cache.delete(key);
  });
  while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
  return p;
}

// 録音が入れ替わったとき（編集し直して公開した・保存済みのコピーを最新にした）に、覚えている古い計算を捨てる。
// name は、録音の名前（URL に含まれる）。「大きく見る」「窓の 3D」が、編集前の形を出さないように
export function forgetSpectrogram(name) {
  if (!name) return;
  for (const key of [...cache.keys()]) if (key.includes(name)) cache.delete(key);
}
