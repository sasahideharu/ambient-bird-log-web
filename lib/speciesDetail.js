import { supabase } from "./supabaseClient";
import { parseWavFilename } from "./parseWav";

export async function fetchSpeciesDetail(commonName) {
  const [{ data: detections, error: detErr }, { data: images, error: imgErr }] =
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
  if (!detections || detections.length === 0) return null;

  const records = detections.map((d) => {
    const parsed = parseWavFilename(d.wav_filename);
    return {
      id: String(d.id),
      confidence: Math.round(d.confidence * 100),
      date: parsed?.date ?? "―",
      time: parsed?.time ?? "―",
      location: d.location_name,
    };
  });

  return {
    name: commonName,
    scientificName: detections[0].scientific_name,
    imageUrl: images?.image_url ?? null,
    locationCount: new Set(detections.map((d) => d.location_name)).size,
    records,
  };
}
