import { supabase } from "./supabaseClient";
import { mergeConsecutiveDetections } from "./mergeConsecutive";

export async function fetchDetections() {
  const { data, error } = await supabase
    .from("detections")
    .select(
      "id, wav_filename, start_sec, end_sec, scientific_name, common_name, confidence, created_at, location_name, latitude, longitude"
    )
    .order("created_at", { ascending: false });

  if (error) throw error;
  return mergeConsecutiveDetections(data ?? []);
}

export async function fetchBirdImages() {
  const { data, error } = await supabase
    .from("bird_master")
    .select("common_name, image_url");

  if (error) throw error;
  return data;
}

// 🔥 音声ファイル（mp3）の公開URLを取得する
// 実装コードのバケット名 "bird-wav" に合わせている
export function getAudioUrl(wavFilename) {
  if (!wavFilename) return null;
  const { data } = supabase.storage.from("bird-wav").getPublicUrl(wavFilename);
  return data?.publicUrl ?? null;
}
