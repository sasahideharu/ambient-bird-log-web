import { parseWavFilename } from "./parseWav";

// detectionsの生データを、各画面で共通して使う表示用の形に整形する
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
  };
}
