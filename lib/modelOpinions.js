// 🔥 別のモデル（Perch 2.0）の「意見」（管理者だけ）。BirdNET の記録に対して、同じ録音の同じ時間で、Perch が、どの鳥を上位にしたか。
//    表：model_opinions（db/migrations/2026-09-20_create_model_opinions.sql）。管理者名簿にいる人だけが、読める・書ける
//    ・Perch は、5秒ごとに上位5種を返す（サーバー：server/analyzer_app.py の run_perch_analysis）。点数は logit（確かな検出は 9〜12・雑音は 4〜7 の目安）
//    ・鳥の名前は、BirdNET の学名に直してある（シジュウカラ：Perch の Parus major → BirdNET の Parus minor）

import { supabase } from "./supabaseClient";

export const PERCH = "Perch";
const INSERT_BATCH_SIZE = 500;
const DELETE_FILE_BATCH = 40;
const PAGE = 1000;

// 解析の結果（analysis.results：名前 → { perch: { windows: [{ t0, t1, top: [{ sci, common, logit, prob }] }] } }）→ 保存する行
export function opinionRows(results, meta) {
  const perch = meta?.perch;
  if (!perch) return [];
  const rows = [];
  for (const [name, res] of Object.entries(results)) {
    for (const w of res?.perch?.windows ?? []) {
      w.top.forEach((t, i) => {
        rows.push({
          wav_filename: name,
          model_name: perch.model_name,
          model_version: perch.model_version,
          t0_sec: w.t0,
          t1_sec: w.t1,
          rank: i + 1,
          scientific_name: t.sci,
          common_name: t.common ?? null,
          logit: t.logit,
          prob: t.prob,
          analyzed_at: meta.analyzed_at,
          params: {
            variant: perch.variant,
            window_sec: perch.window_sec,
            top_k: perch.top_k,
            location_filter: perch.location_filter,
            sf_thresh: perch.sf_thresh,
          },
        });
      });
    }
  }
  return rows;
}

// 保存する（同じ録音の、いまある Perch の行を消してから、入れ直す＝やり直しで、区間・順位が変わっても、古い行が残らない）
export async function saveOpinions(rows) {
  if (rows.length === 0) return 0;
  const files = [...new Set(rows.map((r) => r.wav_filename))];
  const models = [...new Set(rows.map((r) => r.model_name))];
  for (let i = 0; i < files.length; i += DELETE_FILE_BATCH) {
    const { error } = await supabase
      .from("model_opinions")
      .delete()
      .in("wav_filename", files.slice(i, i + DELETE_FILE_BATCH))
      .in("model_name", models);
    if (error) throw error;
  }
  for (let i = 0; i < rows.length; i += INSERT_BATCH_SIZE) {
    const { error } = await supabase.from("model_opinions").insert(rows.slice(i, i + INSERT_BATCH_SIZE));
    if (error) throw error;
  }
  return rows.length;
}

// 行の一覧 → 区間ごとの上位（judge に渡せる形）
export function rowsToWindows(rows) {
  const byStart = new Map();
  for (const r of rows) {
    const key = r.t0_sec;
    if (!byStart.has(key)) byStart.set(key, { t0: r.t0_sec, t1: r.t1_sec, top: [] });
    byStart.get(key).top.push({ sci: r.scientific_name, common: r.common_name, logit: r.logit, prob: r.prob, rank: r.rank });
  }
  const windows = [...byStart.values()].sort((a, b) => a.t0 - b.t0);
  for (const w of windows) w.top.sort((a, b) => a.rank - b.rank);
  return windows;
}

// この録音の、この時間（startSec〜endSec）に重なる区間の、Perch の意見
export async function fetchOpinions(wavFilename, startSec, endSec) {
  const { data, error } = await supabase
    .from("model_opinions")
    .select("t0_sec, t1_sec, rank, scientific_name, common_name, logit, prob, model_version")
    .eq("wav_filename", wavFilename)
    .eq("model_name", PERCH)
    .lt("t0_sec", endSec)
    .gt("t1_sec", startSec)
    .order("t0_sec", { ascending: true })
    .order("rank", { ascending: true });
  if (error) throw error;
  return rowsToWindows(data ?? []);
}

const overlap = (a0, a1, b0, b1) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));

// BirdNET の記録（学名 sci・時間 startSec〜endSec）が、Perch の上位（windows）に入っているか。
//   戻り値：{ status："same"（上位に、同じ鳥）／"other"（上位に、同じ鳥がいない）／"none"（Perch の意見が無い）, rank, logit, window（一番重なる区間）}
export function judge(sci, windows, startSec, endSec) {
  const near = (windows ?? []).filter((w) => overlap(startSec, endSec, w.t0, w.t1) > 0);
  if (near.length === 0) return { status: "none", rank: null, logit: null, window: null };
  let best = null;
  for (const w of near) {
    const i = w.top.findIndex((t) => t.sci === sci);
    if (i >= 0 && (!best || i + 1 < best.rank)) best = { rank: i + 1, logit: w.top[i].logit, window: w };
  }
  if (best) return { status: "same", ...best };
  const main = near.reduce((a, b) => (overlap(startSec, endSec, b.t0, b.t1) > overlap(startSec, endSec, a.t0, a.t1) ? b : a));
  return { status: "other", rank: null, logit: null, window: main };
}

// ---------- 既存の録音に、Perch をかけるための一覧（管理画面） ----------

async function fetchAll(makeQuery) {
  const all = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await makeQuery().range(from, from + PAGE - 1);
    if (error) throw error;
    all.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return all;
}

// 記録のある録音（場所つき）の一覧：[{ name, latitude, longitude, place }]（名前の順）
export async function listRecordedFiles() {
  const rows = await fetchAll(() =>
    supabase
      .from("detections")
      .select("wav_filename, latitude, longitude, location_name")
      .not("latitude", "is", null)
      .not("longitude", "is", null)
      .order("id", { ascending: true })
  );
  const seen = new Map();
  for (const r of rows) {
    if (r.wav_filename?.endsWith(".mp3") && !seen.has(r.wav_filename)) {
      seen.set(r.wav_filename, { name: r.wav_filename, latitude: r.latitude, longitude: r.longitude, place: r.location_name });
    }
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// すでに Perch の意見がある録音の名前（集合）
export async function listOpinionFileNames() {
  const rows = await fetchAll(() =>
    supabase.from("model_opinions").select("wav_filename").eq("model_name", PERCH).eq("rank", 1).order("id", { ascending: true })
  );
  return new Set(rows.map((r) => r.wav_filename));
}
