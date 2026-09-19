import { supabase } from "./supabaseClient";
import { toRecord } from "./record";
import { mergeConsecutiveDetections } from "./mergeConsecutive";
import { withOfflineFallback } from "./offline";

// detections は、連続した検出を結合済みのもの
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

async function fetchLocationDetailRemote(locationName) {
  const { data, error } = await supabase
    .from("detections")
    .select(
      "id, wav_filename, start_sec, end_sec, scientific_name, common_name, confidence, created_at, location_name, latitude, longitude"
    )
    .eq("location_name", locationName)
    .order("created_at", { ascending: false });

  if (error) throw error;
  if (!data || data.length === 0) return null;

  return buildLocationDetail(locationName, mergeConsecutiveDetections(data));
}

// アプリで電波が無いときは、保存済みのデータ（各鳥の上位7件）から作る
export function fetchLocationDetail(locationName) {
  return withOfflineFallback(
    () => fetchLocationDetailRemote(locationName),
    (saved) =>
      buildLocationDetail(
        locationName,
        saved.detections.filter((d) => d.location_name === locationName)
      )
  );
}
