import { toRecord } from "./record";
import { fetchDetectionsRemote, forCurrentViewer } from "./queries";
import { withOfflineFallback } from "./offline";

// detections は、連続した検出を結合済みで、人の判断（確定・修正・除外）を反映済みのもの
function buildLocationDetail(locationName, detections) {
  if (detections.length === 0) return null;

  const records = detections.map(toRecord).sort((a, b) => (a.isoDate < b.isoDate ? 1 : -1));
  const speciesCount = new Set(records.map((r) => r.species)).size;
  const withCoords = records.find((r) => r.latitude != null && r.longitude != null);

  return {
    name: locationName,
    speciesCount,
    records,
    latitude: withCoords?.latitude ?? null,
    longitude: withCoords?.longitude ?? null,
    lastSeen: records[0]?.date ?? "―",
  };
}

// 全記録（人の判断を反映済み）から、この場所の分を絞り込む
async function fetchLocationDetailRemote(locationName) {
  const rows = await fetchDetectionsRemote();
  return buildLocationDetail(
    locationName,
    rows.filter((d) => d.location_name === locationName)
  );
}

// アプリで電波が無いときは、保存済みのデータ（各鳥の上位7件）から作る
export function fetchLocationDetail(locationName) {
  return withOfflineFallback(
    () => fetchLocationDetailRemote(locationName),
    async (saved) =>
      buildLocationDetail(
        locationName,
        (await forCurrentViewer(saved.detections)).filter((d) => d.location_name === locationName)
      )
  );
}
