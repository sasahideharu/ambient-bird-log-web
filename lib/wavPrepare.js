// 🔥 WAV をそのまま選んで登録できるように、画面（ブラウザ）の中で、WAV を作り直す。
//    Zoom F3 の WAV（192kHz・32bit float）は、1本 10〜50MB もあり、そのまま上げると重い。
//    BirdNET は、内部で 48kHz にして解析するので、48kHz・16bit にしても、解析の精度は変わらない（サイズは約 1/8）。
//    ・元の WAV は、どこにも送らない（この端末の中で読むだけ）
//    ・作るもの：①解析用の WAV（48kHz・16bit）＝サーバーに解析してもらうために、一時的に保存する（解析のあとで、消す）
//               ②再生用の MP3（48kHz・192kbps）＝登録するときに保存する。ステレオは、ステレオのまま
//    ・名前：WAV の中に入っている録音開始時刻（Zoom の bext）から、<元の名前>_<時分>（例 260905_013.WAV → 260905_013_1104）。
//      いまの Mac の変換（scripts/convert_daily.py）と同じ規則。時刻が無ければ、ファイルの更新時刻

import { encodeWav } from "./wav";
import { encodeMp3 } from "./mp3";

const TARGET_RATE = 48000;
const HEADER_SCAN_BYTES = 512 * 1024; // 先頭のこの範囲に、チャンクの並び（bext など）がある
const MAX_ANALYZE_BYTES = 20 * 1024 * 1024; // 解析サーバーが受け付ける1ファイルの上限（server/analyzer_app.py の MAX_FILE_BYTES と同じ）

export const isWavName = (name) => /\.wav$/i.test(name ?? "");

const pad2 = (n) => String(n).padStart(2, "0");

// WAV の先頭を読んで、形式と、録音開始時刻（bext）を取り出す。読めなければ、null の項目になる
//   RIFF ＋ [チャンク名4文字＋長さ4バイト＋中身]… の並び。bext の中身：説明256・作成者32・作成者の参照32・日付10（YYYY-MM-DD）・時刻8（HH:MM:SS）…
export async function readWavHeader(file) {
  const head = new DataView(await file.slice(0, HEADER_SCAN_BYTES).arrayBuffer());
  const text = (o, n) => {
    let s = "";
    for (let i = 0; i < n && o + i < head.byteLength; i++) s += String.fromCharCode(head.getUint8(o + i));
    return s;
  };
  const out = { valid: false, format: null, channels: null, sampleRate: null, bits: null, startTime: null };
  if (head.byteLength < 12 || text(0, 4) !== "RIFF" || text(8, 4) !== "WAVE") return out;
  out.valid = true;

  let pos = 12;
  while (pos + 8 <= head.byteLength) {
    const id = text(pos, 4);
    const size = head.getUint32(pos + 4, true);
    const body = pos + 8;
    if (id === "fmt " && body + 16 <= head.byteLength) {
      out.format = head.getUint16(body, true);
      out.channels = head.getUint16(body + 2, true);
      out.sampleRate = head.getUint32(body + 4, true);
      out.bits = head.getUint16(body + 14, true);
    } else if (id === "bext" && body + 338 <= head.byteLength) {
      const date = text(body + 320, 10);
      const time = text(body + 330, 8);
      const m = /^(\d{2}):(\d{2}):(\d{2})$/.exec(time);
      if (m && /^\d{4}-\d{2}-\d{2}$/.test(date)) out.startTime = { hh: m[1], mm: m[2], date };
    } else if (id === "data") {
      break; // 音のデータ。これ以降に、調べるものは無い
    }
    pos = body + size + (size & 1);
  }
  return out;
}

// 元の名前（拡張子なし）に、録音開始の時分を付ける。すでに付いていれば（例 260905_013_1104）、そのまま
export function nameWithTime(stem, startTime, lastModified) {
  if (/^\d{6}_\d+_\d{4}$/.test(stem)) return { stem, timeSource: "名前に含まれている" };
  if (startTime) return { stem: `${stem}_${startTime.hh}${startTime.mm}`, timeSource: "WAV の録音開始時刻" };
  const d = new Date(lastModified);
  return { stem: `${stem}_${pad2(d.getHours())}${pad2(d.getMinutes())}`, timeSource: "ファイルの更新時刻" };
}

// WAV を、解析用の WAV（48kHz・16bit）と、再生用の MP3 にする
//   戻り値：{ name（登録する MP3 の名前）, mp3File, wavFile（解析用・名前は <stem>.wav）, info }
export async function prepareWav(file) {
  const header = await readWavHeader(file);
  if (!header.valid) throw new Error("WAV として読めません（ファイルが壊れているか、WAV ではありません）");

  const stemRaw = file.name.replace(/\.wav$/i, "");
  const { stem, timeSource } = nameWithTime(stemRaw, header.startTime, file.lastModified);
  if (!/^[A-Za-z0-9._-]+$/.test(stem)) throw new Error("名前に使えない文字があります（英数字と「.」「_」「-」だけ使えます）");

  // 48kHz にして読み込む（ブラウザの読み込み機能が、変換までしてくれる）。
  // 読み込み（デコード）だけに使う。本物の AudioContext は、iPhone の音の出方（消音スイッチ）に影響するので、使わない
  const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!Offline) throw new Error("この端末（ブラウザ）は、音の読み込みに対応していません");
  const decoder = new Offline(1, 1, TARGET_RATE);
  let decoded;
  try {
    const bytes = await file.arrayBuffer();
    decoded = await new Promise((resolve, reject) => decoder.decodeAudioData(bytes, resolve, reject));
  } catch (err) {
    console.error(err);
    throw new Error("この端末（ブラウザ）では、この WAV を読み込めませんでした。パソコンのブラウザでお試しください");
  }
  if (decoded.numberOfChannels > 2) throw new Error(`${decoded.numberOfChannels}チャンネルの WAV は、まだ使えません（モノラル・ステレオだけ）`);

  const channels = [];
  for (let c = 0; c < decoded.numberOfChannels; c++) channels.push(new Float32Array(decoded.getChannelData(c)));

  // 32bit float は、1を超えることがある。超えていたら、全体を小さくして、割れない（音が歪まない）ようにする
  let peak = 0;
  for (const ch of channels) for (let i = 0; i < ch.length; i++) peak = Math.max(peak, Math.abs(ch[i]));
  if (peak > 1) for (const ch of channels) for (let i = 0; i < ch.length; i++) ch[i] /= peak;

  const rate = decoded.sampleRate;
  const wavBlob = encodeWav(channels, rate);
  if (wavBlob.size > MAX_ANALYZE_BYTES) {
    throw new Error("録音が長すぎて、解析サーバーに送れません（ステレオで約100秒まで）");
  }
  const mp3Blob = await encodeMp3(channels, rate);

  return {
    name: `${stem}.mp3`,
    mp3File: new File([mp3Blob], `${stem}.mp3`, { type: "audio/mpeg" }),
    wavFile: new File([wavBlob], `${stem}.wav`, { type: "audio/wav" }),
    info: {
      originalName: file.name,
      originalBytes: file.size,
      originalRate: header.sampleRate,
      originalBits: header.bits,
      channels: channels.length,
      durationSec: decoded.duration,
      timeSource,
      wavBytes: wavBlob.size,
      mp3Bytes: mp3Blob.size,
      scaled: peak > 1,
    },
  };
}
