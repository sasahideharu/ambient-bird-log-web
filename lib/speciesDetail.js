import { supabase } from "./supabaseClient";
import { toRecord } from "./record";
import { mergeConsecutiveDetections } from "./mergeConsecutive";
import { withOfflineFallback, getSavedImageUrl } from "./offline";

// detections は、連続した検出を結合済みのもの
function buildSpeciesDetail(commonName, detections, imageUrl) {
  if (detections.length === 0) return null;
  return {
    name: commonName,
    scientificName: detections[0].scientific_name,
    imageUrl,
    locationCount: new Set(detections.map((d) => d.location_name)).size,
    records: detections.map(toRecord),
  };
}

async function fetchSpeciesDetailRemote(commonName) {
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

  const originalImage = images?.image_url ?? null;
  return buildSpeciesDetail(
    commonName,
    mergeConsecutiveDetections(rawDetections),
    getSavedImageUrl(originalImage) ?? originalImage
  );
}

// アプリで電波が無いときは、保存済みのデータ（各鳥の上位7件）から作る
export function fetchSpeciesDetail(commonName) {
  return withOfflineFallback(
    () => fetchSpeciesDetailRemote(commonName),
    (saved) => {
      const rows = saved.detections.filter((d) => d.common_name === commonName);
      const originalImage =
        saved.birdImages.find((b) => b.common_name === commonName)?.image_url ?? null;
      return buildSpeciesDetail(
        commonName,
        rows,
        getSavedImageUrl(originalImage) ?? originalImage
      );
    }
  );
}
