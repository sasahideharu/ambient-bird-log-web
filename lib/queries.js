import { supabase } from "./supabaseClient";

export async function fetchDetections() {
  const { data, error } = await supabase
    .from("detections")
    .select(
      "id, wav_filename, start_sec, end_sec, scientific_name, common_name, confidence, created_at, location_name"
    )
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data;
}

export async function fetchBirdImages() {
  const { data, error } = await supabase
    .from("bird_master")
    .select("common_name, image_url");

  if (error) throw error;
  return data;
}
