// 🔥 解析用の WAV（画面で 48kHz・16bit に変換したもの）の、一時的な保存と、削除（ログイン中の管理者だけ）。
//    サーバー（BirdNET）は、保管場所（bird-wav）にあるファイルを、名前で指定して解析するので、解析のあいだだけ、置いておく。
//    解析が終わったら、消す（公開している MP3 と、鳥の写真は、この権限では消せない：db/migrations/2026-09-20_storage_delete_analysis_wav.sql）

import { supabase } from "./supabaseClient";

const AUDIO_BUCKET = "bird-wav";

// 解析用の WAV を保存する（同じ名前は、上書き）。失敗したものは failed に入る
export async function uploadAnalysisWavs(wavFiles, onProgress) {
  const failed = [];
  for (let i = 0; i < wavFiles.length; i++) {
    onProgress?.({ stage: "wav", done: i, total: wavFiles.length });
    const file = wavFiles[i];
    const { error } = await supabase.storage
      .from(AUDIO_BUCKET)
      .upload(file.name, file, { contentType: "audio/wav", upsert: true, cacheControl: "0" });
    if (error) failed.push({ name: file.name, message: error.message });
  }
  onProgress?.({ stage: "wav", done: wavFiles.length, total: wavFiles.length });
  return failed;
}

// 解析用の WAV を消す。消せなかった名前の一覧を返す（消す権限は、小文字の .wav だけ。権限が無いと、何も消えずに、空で返る）
export async function deleteAnalysisWavs(names) {
  if (names.length === 0) return [];
  const { data, error } = await supabase.storage.from(AUDIO_BUCKET).remove(names);
  if (error) return names;
  const removed = new Set((data ?? []).map((o) => o.name));
  return names.filter((n) => !removed.has(n));
}
