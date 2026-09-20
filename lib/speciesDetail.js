import { supabase } from "./supabaseClient";
import { toRecord } from "./record";
import { fetchDetectionsRemote } from "./queries";
import { withOfflineFallback, getSavedImageUrl } from "./offline";
import { largeImageUrl } from "./imageUrl";

// 詳細画面に使う写真のURL。保存済みなら端末内のファイル。無ければ、軽く縮小した写真（幅1200px）
function detailImageUrl(originalImage) {
  return getSavedImageUrl(originalImage) ?? largeImageUrl(originalImage);
}

// detections は、連続した検出を結合済みで、人の判断（確定・修正・除外）を反映済みのもの
function buildSpeciesDetail(commonName, detections, imageUrl) {
  if (detections.length === 0) return null;
  return {
    name: commonName,
    // 修正で新しく付けた鳥は、学名が無いことがある
    scientificName: detections.find((d) => d.scientific_name)?.scientific_name ?? null,
    imageUrl,
    locationCount: new Set(detections.map((d) => d.location_name)).size,
    records: detections.map(toRecord),
  };
}

// 🔥 鳥の名前は、人の修正を反映した後の名前で探す。
//    （元は別の鳥として検出された記録が、この鳥に修正されている場合もあれば、逆に、
//     この鳥として検出された記録が、別の鳥に修正されている場合もあるため、全記録を取ってから絞り込む）
async function fetchSpeciesDetailRemote(commonName) {
  const [rows, { data: images, error: imgErr }] = await Promise.all([
    fetchDetectionsRemote(),
    supabase
      .from("bird_master")
      .select("common_name, image_url")
      .eq("common_name", commonName)
      .maybeSingle(),
  ]);

  if (imgErr) throw imgErr;
  const mine = rows.filter((d) => d.common_name === commonName);
  if (mine.length === 0) return null;

  const originalImage = images?.image_url ?? null;
  return buildSpeciesDetail(commonName, mine, detailImageUrl(originalImage));
}

// アプリで電波が無いときは、保存済みのデータ（各鳥の上位7件）から作る
export function fetchSpeciesDetail(commonName) {
  return withOfflineFallback(
    () => fetchSpeciesDetailRemote(commonName),
    (saved) => {
      const rows = saved.detections.filter((d) => d.common_name === commonName);
      const originalImage =
        saved.birdImages.find((b) => b.common_name === commonName)?.image_url ?? null;
      return buildSpeciesDetail(commonName, rows, detailImageUrl(originalImage));
    }
  );
}
