import { fetchDetections } from "./queries";
import { toRecord } from "./record";

// wav_filenameには年月日の下2桁しか入っていないため、
// 一旦全件取得してからISO日付で絞り込む
export async function fetchDateDetail(isoDate) {
  const detections = await fetchDetections();
  const records = detections
    .map(toRecord)
    .filter((r) => r.isoDate === isoDate)
    .sort((a, b) => (a.time > b.time ? -1 : 1));

  if (records.length === 0) return null;

  const speciesCount = new Set(records.map((r) => r.species)).size;
  const locationCount = new Set(records.map((r) => r.location)).size;

  return {
    isoDate,
    date: records[0].date,
    speciesCount,
    locationCount,
    records,
  };
}
