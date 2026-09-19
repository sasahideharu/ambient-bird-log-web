import { supabase } from "./supabaseClient";
import { mergeConsecutiveDetections } from "./mergeConsecutive";
import { withOfflineFallback, getSavedAudioUrl, getSavedImageUrl } from "./offline";

// 🔥 ネットから取る処理。オフライン保存の「保存・更新」でも、最新のデータを取るために使う
export async function fetchDetectionsRemote() {
  const { data, error } = await supabase
    .from("detections")
    .select(
      "id, wav_filename, start_sec, end_sec, scientific_name, common_name, confidence, created_at, location_name, latitude, longitude"
    )
    .order("created_at", { ascending: false });

  if (error) throw error;
  return mergeConsecutiveDetections(data ?? []);
}

export async function fetchBirdImagesRemote() {
  const { data, error } = await supabase
    .from("bird_master")
    .select("common_name, image_url");

  if (error) throw error;
  return data;
}

// 保存済みの写真があれば、端末内のURLに差し替える（速く、圏外でも表示できる）
function localizeImages(rows) {
  return (rows ?? []).map((r) => ({
    ...r,
    image_url: getSavedImageUrl(r.image_url) ?? r.image_url,
  }));
}

// アプリで、電波が無いとき（または5秒以内に応答が無いとき）は、保存データに自動で切り替わる。
// Web版・保存が無いときは、今までどおりネットから取得する
export function fetchDetections() {
  return withOfflineFallback(fetchDetectionsRemote, (saved) => saved.detections);
}

export function fetchBirdImages() {
  return withOfflineFallback(
    async () => localizeImages(await fetchBirdImagesRemote()),
    (saved) => localizeImages(saved.birdImages)
  );
}

// 🔥 音声ファイル（mp3）の公開URLを取得する
// 実装コードのバケット名 "bird-wav" に合わせている
export function getRemoteAudioUrl(wavFilename) {
  if (!wavFilename) return null;
  const { data } = supabase.storage.from("bird-wav").getPublicUrl(wavFilename);
  return data?.publicUrl ?? null;
}

// 端末に保存済みの音声があれば、その端末内のURLを返す。無ければネットのURL
export function getAudioUrl(wavFilename) {
  if (!wavFilename) return null;
  return getSavedAudioUrl(wavFilename) ?? getRemoteAudioUrl(wavFilename);
}
