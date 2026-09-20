import { parseWavFilename } from "./parseWav";

// detectionsの生データを、各画面で共通して使う表示用の形に整形する
//   人の判断（確定・修正）があるときは、鳥の名前と信頼度が「判断後」のものになっている（lib/verifications.js）。
//   元の鳥・元の信頼度は original* に残っている
export function toRecord(d) {
  const parsed = parseWavFilename(d.wav_filename);
  return {
    id: String(d.id),
    species: d.common_name,
    scientificName: d.scientific_name,
    confidence: Math.round(d.confidence * 100),
    date: parsed?.date ?? "―",
    isoDate: parsed?.isoDate ?? null,
    time: parsed?.time ?? "―",
    location: d.location_name,
    wavFilename: d.wav_filename,
    startSec: d.start_sec,
    endSec: d.end_sec,
    latitude: d.latitude ?? null,
    longitude: d.longitude ?? null,
    // 修正・確定
    verification: d.verification ?? null, // { id, status, method, note }。判断が無ければ null
    originalCommonName: d.original_common_name ?? d.common_name,
    originalScientificName: d.original_scientific_name ?? d.scientific_name,
    originalConfidence: Math.round((d.original_confidence ?? d.confidence) * 100),
  };
}
