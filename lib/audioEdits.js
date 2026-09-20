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
