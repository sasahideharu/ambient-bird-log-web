import { supabase } from "./supabaseClient";
import { toRecord } from "./record";
import { mergeConsecutiveDetections } from "./mergeConsecutive";

export async function fetchLocationDetail(locationName) {
  const { data, error } = await supabase
    .from("detections")
    .select(
      "id, wav_filename, start_sec, end_sec, scientific_name, common_name, confidence, created_at, location_name, latitude, longitude"
    )
    .eq("location_name", locationName)
    .order("created_at", { ascending: false });

  if (error) throw error;
  if (!data || data.length === 0) return null;

  const merged = mergeConsecutiveDetections(data);
  const records = merged.map(toRecord).sort((a, b) => (a.isoDate < b.isoDate ? 1 : -1));
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
