import { supabase } from "./supabaseClient";
import { mergeConsecutiveDetections } from "./mergeConsecutive";
import { withOfflineFallback, getSavedAudioUrl, getSavedImageUrl } from "./offline";
import { getLoginState, hasLoginSession } from "./auth";
import { thumbImageUrl } from "./imageUrl";
import { fetchVerificationsRemote, applyVerifications, pickRejected } from "./verifications";

// 🔥 ログインしていない人は、緯度経度（latitude / longitude）を取れない（データベース側でも制限する）。
//    ログインしていないのに座標の列を要求するとエラーになるため、要求する列を切り替える
export const PUBLIC_COLUMNS =
  "id, wav_filename, start_sec, end_sec, scientific_name, common_name, confidence, created_at, location_name";
export const MEMBER_COLUMNS = `${PUBLIC_COLUMNS}, latitude, longitude`;

export async function detectionColumns() {
  return (await hasLoginSession()) ? MEMBER_COLUMNS : PUBLIC_COLUMNS;
}

// ログインしていない人に、保存データの座標と、人の判断のメモ・根拠が渡らないようにする
export async function forCurrentViewer(rows) {
  const { loggedIn } = await getLoginState();
  if (loggedIn) return rows;
  return rows.map((r) => ({
    ...r,
    latitude: null,
    longitude: null,
    verification: r.verification ? { ...r.verification, method: null, note: null } : r.verification,
  }));
}

// 🔥 ネットから取る処理。オフライン保存の「保存・更新」でも、最新のデータを取るために使う。
//    人の判断（確定・修正・除外）を重ねた後の記録を返す。修正した鳥の名前・確定した信頼度100%が反映され、
//    除外した記録は含まれない（元の鳥・元の信頼度は original_* に残る）
export async function fetchDetectionsRemote() {
  const { merged, verifications } = await fetchMergedAndVerifications();
  return applyVerifications(merged, verifications);
}

// 除外した記録だけ（「除外した記録」の画面で、除外を取り消すために使う）
export async function fetchRejectedRemote() {
  const { merged, verifications } = await fetchMergedAndVerifications();
  return pickRejected(merged, verifications);
}

// 記録（連続した検出を結合済み）と、人の判断を、同時に取る
async function fetchMergedAndVerifications() {
  const [{ data, error }, verifications] = await Promise.all([
    supabase
      .from("detections")
      .select(await detectionColumns())
      .order("created_at", { ascending: false }),
    fetchVerificationsRemote(),
  ]);

  if (error) throw error;
  return { merged: mergeConsecutiveDetections(data ?? []), verifications };
}

export async function fetchBirdImagesRemote() {
  const { data, error } = await supabase
    .from("bird_master")
    .select("common_name, image_url");

  if (error) throw error;
  return data;
}

// 一覧のタイルに使う写真のURLにする。
// 保存済みなら端末内のファイル（速く、圏外でも表示できる）。無ければ、軽く縮小した写真（幅420px）
function localizeImages(rows) {
  return (rows ?? []).map((r) => ({
    ...r,
    image_url: getSavedImageUrl(r.image_url) ?? thumbImageUrl(r.image_url),
  }));
}

// アプリで、電波が無いとき（または5秒以内に応答が無いとき）は、保存データに自動で切り替わる。
// Web版・保存が無いときは、今までどおりネットから取得する
export function fetchDetections() {
  return withOfflineFallback(fetchDetectionsRemote, (saved) => forCurrentViewer(saved.detections));
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
