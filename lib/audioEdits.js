// 🔥 音声の編集（フォーカス）の「設定」の保存・読み込み・削除（ログイン中の管理者だけ。自分の設定だけが見える）。
//    表：audio_edits（db/migrations/2026-09-20_create_audio_edits.sql）
//    ・保存＝範囲（時間・周波数）と、下げ方の設定だけ。元の音は変わらない。加工した音の書き出し（公開）は、別の段階
//    ・連番（seq）は、同じ録音ごとに 1, 2, 3 … 。書き出すファイル名（<元の名前>_e<連番>.mp3）になる
//    ・公開したものは、もう直せない・消せない（データベース側で制限）

import { supabase } from "./supabaseClient";
import { DEFAULT_FOCUS } from "./audioFocus";

const round3 = (v) => Math.round(v * 1000) / 1000;

// 選んだ範囲 → 保存する行
export function editRow(sel, normalize) {
  return {
    t0_sec: round3(sel.t0),
    t1_sec: round3(sel.t1),
    f_lo_hz: Math.round(sel.fLo),
    f_hi_hz: Math.round(sel.fHi),
    settings: {
      mode: sel.mode,
      strengthDb: sel.strengthDb,
      steep: sel.steep,
      curve: sel.curve,
      octaveDb: sel.octaveDb,
      floorDb: sel.floorDb ?? null,
      normalize,
    },
  };
}

// 「保存したあとに、変更したか」を調べるための印（同じ内容なら、同じ文字列）
export const editKey = (sel, normalize) => JSON.stringify(editRow(sel, normalize));

// 保存した行 → 編集画面の範囲（id は、画面の中だけの番号）
export function rowToSelection(row, id) {
  const sel = {
    id,
    dbId: row.id,
    seq: row.seq,
    published: !!row.published_at,
    exportedName: row.exported_wav_filename ?? null,
    t0: round3(row.t0_sec),
    t1: round3(row.t1_sec),
    fLo: Math.round(row.f_lo_hz),
    fHi: Math.round(row.f_hi_hz),
    ...DEFAULT_FOCUS,
    ...pickSettings(row.settings),
  };
  sel.savedKey = editKey(sel, row.settings?.normalize ?? true);
  return sel;
}

function pickSettings(settings) {
  const out = {};
  for (const key of ["mode", "strengthDb", "steep", "curve", "octaveDb", "floorDb"]) {
    if (settings && settings[key] !== undefined) out[key] = settings[key];
  }
  return out;
}

// この録音に、保存してある範囲の一覧（連番の順）
export async function listEdits(sourceName) {
  const { data, error } = await supabase
    .from("audio_edits")
    .select("*")
    .eq("source_wav_filename", sourceName)
    .order("seq", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

// 保存する。dbId があれば、その行を直す。無ければ、新しい連番で作る。戻り値：保存した行
export async function saveEdit({ sourceName, sel, normalize }) {
  const row = { ...editRow(sel, normalize), updated_at: new Date().toISOString() };

  if (sel.dbId) {
    const { data, error } = await supabase.from("audio_edits").update(row).eq("id", sel.dbId).select().single();
    if (error) throw error;
    return data;
  }

  // 新しい連番：いまある一番大きい番号＋1。同じ番号が、他で使われていたら（重複エラー）、次の番号でやり直す
  const { data: last, error: lastError } = await supabase
    .from("audio_edits")
    .select("seq")
    .eq("source_wav_filename", sourceName)
    .order("seq", { ascending: false })
    .limit(1);
  if (lastError) throw lastError;
  const base = (last?.[0]?.seq ?? 0) + 1;
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data, error } = await supabase
      .from("audio_edits")
      .insert({ source_wav_filename: sourceName, seq: base + attempt, ...row })
      .select()
      .single();
    if (!error) return data;
    if (error.code !== "23505") throw error; // 重複以外のエラーは、そのまま伝える
  }
  throw new Error("連番を決められませんでした。もう一度、保存してください。");
}

// 保存した設定を消す（公開していないものだけ。公開したものは、データベース側で拒否される）
export async function deleteEdit(dbId) {
  const { data, error } = await supabase.from("audio_edits").delete().eq("id", dbId).select("id");
  if (error) throw error;
  if (!data || data.length === 0) throw new Error("消せませんでした（公開済みか、すでに無い設定です）");
}

// ---------- 書き出し・公開 ----------
//   書き出し：加工した音を MP3 にして、保管場所（bird-wav）に保存 → サーバーで解析（まだ、みんなには見えない）
//   公開　　：解析の記録を登録（detections）→ published_at を入れる。それ以降は、直せない・消せない

const AUDIO_BUCKET = "bird-wav";

// 書き出す MP3 の名前：<元の名前（.mp3 を除く）>_e<連番>.mp3。元が .mp3 でなければ null
export function exportedName(sourceName, seq) {
  const m = /^(.+)\.mp3$/.exec(sourceName ?? "");
  return m ? `${m[1]}_e${seq}.mp3` : null;
}

// すでに書き出した録音（名前が _e連番.mp3）は、さらに編集して公開することはしない
export const isEditedName = (name) => /_e\d+\.mp3$/.test(name ?? "");

// 元の録音の場所（名前・緯度経度）。元の録音に記録があるときだけ分かる（書き出した録音も、同じ場所にするため）
export async function fetchSourceLocation(sourceName) {
  const { data, error } = await supabase
    .from("detections")
    .select("location_name, latitude, longitude")
    .eq("wav_filename", sourceName)
    .not("latitude", "is", null)
    .not("longitude", "is", null)
    .limit(1);
  if (error) throw error;
  const row = data?.[0];
  if (!row?.location_name) return null;
  return { name: row.location_name, latitude: row.latitude, longitude: row.longitude };
}

// 書き出した MP3 を、保管場所に保存する（同じ名前は、上書き。公開前のやり直しのため）。
//   cacheControl "0"：上書きしたあと、解析サーバーや再生が、古い音を見ないようにする
export async function uploadExportedMp3(name, blob) {
  const { error } = await supabase.storage
    .from(AUDIO_BUCKET)
    .upload(name, blob, { contentType: "audio/mpeg", upsert: true, cacheControl: "0" });
  if (error) throw error;
}

// 書き出した名前を、設定の行に記録する（公開前のものだけ直せる）
export async function markExported(dbId, name) {
  const { data, error } = await supabase
    .from("audio_edits")
    .update({ exported_wav_filename: name, updated_at: new Date().toISOString() })
    .eq("id", dbId)
    .select("id");
  if (error) throw error;
  if (!data || data.length === 0) throw new Error("設定を更新できませんでした（公開済みか、すでに無い設定です）");
}

// 公開した印を付ける（記録の登録が終わったあとに呼ぶ。付けたら、もう直せない・消せない）
export async function markPublished(dbId) {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("audio_edits")
    .update({ published_at: now, updated_at: now })
    .eq("id", dbId)
    .select("id");
  if (error) throw error;
  if (!data || data.length === 0) throw new Error("公開の印を付けられませんでした（すでに公開済みか、無い設定です）");
}
