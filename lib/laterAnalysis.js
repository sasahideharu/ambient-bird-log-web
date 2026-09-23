// 🔥 段階3b「あとで解析」：録音のときは電波が無かった・その場では解析しなかった録音を、
//    電波があるときに、本番と同じ解析（BirdNET＋Perch）にかける。
//    まだ「登録」（みんなに見える一覧への公開）はしない。結果は、その録音の記録（meta.laterAnalysis）にだけ残る。
//    ・無圧縮（PCM）の録音は、そのまま MP3 に変換する
//    ・無圧縮が途切れて、別の録音（AAC）が正式になった録音も、対象にする（AAC → 生の音 → MP3、と変換する）

import { supabase } from "./supabaseClient";
import { readBytes, writeMeta } from "./recordingStore";
import { encodeMp3Bytes, birdnetWeek } from "./liveAnalysis";
import { analyzeMp3Files } from "./analyzerClient";
import { isoWithOffset } from "./recorder";
import { floatToInt16 } from "./base64";

const BUCKET = "bird-wav";
const MIN_CONF = 0.1; // 管理者の「解析して登録」画面と、同じ標準値

// この録音は、あとで解析できるか（録音が、最後まで正しく終わっていて、聞ける音があるものだけ）
export function canAnalyzeLater(meta) {
  if (meta?.status !== "recorded") return false;
  if (meta?.audio?.master === "pcm") return (meta.audio?.pcm?.samples ?? 0) > 0;
  if (meta?.audio?.master === "aac") return !!meta.audio?.aac?.ok && (meta.audio?.aac?.bytes ?? 0) > 0;
  return false;
}

function yymmdd(ms) {
  const d = new Date(ms);
  const p2 = (n) => String(n).padStart(2, "0");
  return `${p2(d.getFullYear() % 100)}${p2(d.getMonth() + 1)}${p2(d.getDate())}`;
}

// 保管場所（bird-wav）に置く名前。先頭を YYMMDD_ にすると、サーバー側で録音の日付から自動で「週」（時期の絞り込み）が求まる
function mp3Name(meta) {
  return `${yymmdd(meta.startedAtMs)}_later_${meta.id}.mp3`;
}

// 無圧縮（s16le の生バイト）→ Int16Array（変換なし。そのまま並び替えるだけ）
function pcmBytesToInt16(bytes) {
  return new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2));
}

// AAC（.m4a）の生バイト → Int16Array（端末の音の仕組みで、いったん元の波形に戻してから、変換する）
async function aacBytesToInt16(bytes) {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = new Ctx();
  try {
    const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const audioBuffer = await ctx.decodeAudioData(copy);
    return { int16: floatToInt16(audioBuffer.getChannelData(0)), sampleRate: audioBuffer.sampleRate };
  } finally {
    ctx.close?.();
  }
}

// onProgress({ stage })：reading（音を読み込み中）｜decoding（AACを元の波形に戻す中）｜encoding（MP3に変換中）｜uploading（送信中）｜analyzing（解析中）
// 戻り値：更新した meta（meta.laterAnalysis つき）。失敗したときは、例外を投げる（meta は書き換えない）
export async function runLaterAnalysis(meta, { onProgress } = {}) {
  if (!canAnalyzeLater(meta)) throw new Error("この録音は、あとで解析できません。");

  onProgress?.({ stage: "reading" });
  let int16;
  let sampleRate;
  if (meta.audio.master === "pcm") {
    const bytes = await readBytes(meta.id, "pcm");
    if (!bytes?.length) throw new Error("録音の音が、端末から読めませんでした。");
    int16 = pcmBytesToInt16(bytes);
    sampleRate = meta.audio.sampleRate;
  } else {
    const bytes = await readBytes(meta.id, "aac");
    if (!bytes?.length) throw new Error("録音の音が、端末から読めませんでした。");
    onProgress?.({ stage: "decoding" });
    const decoded = await aacBytesToInt16(bytes);
    int16 = decoded.int16;
    sampleRate = decoded.sampleRate;
  }

  onProgress?.({ stage: "encoding" });
  const mp3 = await encodeMp3Bytes(int16, sampleRate);

  onProgress?.({ stage: "uploading" });
  const name = mp3Name(meta);
  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(name, new Blob([mp3], { type: "audio/mpeg" }), { contentType: "audio/mpeg", upsert: true, cacheControl: "0" });
  if (uploadError) throw uploadError;

  onProgress?.({ stage: "analyzing" });
  const loc = meta.location?.latitude != null && meta.location?.longitude != null ? { lat: meta.location.latitude, lon: meta.location.longitude } : null;
  const { results, warnings } = await analyzeMp3Files({
    names: [name],
    minConf: MIN_CONF,
    location: loc,
    useWeek: true,
    stereo: "best",
    birdnet: true,
    perch: true,
  });
  const result = results[name];
  if (!result || result.error) throw new Error(result?.error || "解析できませんでした。");

  const next = {
    ...meta,
    laterAnalysis: {
      version: 1,
      analyzedAt: isoWithOffset(new Date()),
      week: result.week ?? birdnetWeek(new Date(meta.startedAtMs)),
      rows: result.rows ?? [],
      perch: result.perch ?? null,
      warnings,
    },
  };
  await writeMeta(next);
  return next;
}

// rows（区間ごとの記録）→ 種ごとに、一番高い信頼度でまとめた一覧（信頼度が高い順）
export function summarizeLaterAnalysis(laterAnalysis) {
  const map = new Map();
  for (const r of laterAnalysis?.rows ?? []) {
    const cur = map.get(r.scientific_name);
    if (cur) {
      cur.count += 1;
      if (r.confidence > cur.confidence) cur.confidence = r.confidence;
    } else {
      map.set(r.scientific_name, { sci: r.scientific_name, common: r.common_name, confidence: r.confidence, count: 1 });
    }
  }
  return [...map.values()].sort((a, b) => b.confidence - a.confidence);
}
