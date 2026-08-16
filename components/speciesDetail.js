import { supabase } from "./supabaseClient";
import { toRecord } from "./record";
import { mergeConsecutiveDetections } from "./mergeConsecutive";

export async function fetchSpeciesDetail(commonName) {
  const [{ data: rawDetections, error: detErr }, { data: images, error: imgErr }] =
    await Promise.all([
      supabase
        .from("detections")
        .select(
          "id, wav_filename, start_sec, end_sec, scientific_name, common_name, confidence, created_at, location_name"
        )
        .eq("common_name", commonName)
        .order("created_at", { ascending: false }),
      supabase
        .from("bird_master")
        .select("common_name, image_url")
        .eq("common_name", commonName)
        .maybeSingle(),
    ]);

  if (detErr) throw detErr;
  if (imgErr) throw imgErr;
  if (!rawDetections || rawDetections.length === 0) return null;

  const detections = mergeConsecutiveDetections(rawDetections);
  const records = detections.map(toRecord);

  return {
    name: commonName,
    scientificName: detections[0].scientific_name,
    imageUrl: images?.image_url ?? null,
    locationCount: new Set(detections.map((d) => d.location_name)).size,
    records,
  };
}
