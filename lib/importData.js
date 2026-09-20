// 🔥 データ登録（管理者だけ）。Mac の BirdNET の結果（CSV）と、変換済みの MP3 を、Supabase に登録する。
//    Streamlit の「データ登録」「画像管理」と同じ動きを、新しいアプリに移したもの。
//
//    ・MP3 は、同じ名前があれば上書き
//    ・記録は、（ファイル名・開始秒・終了秒・学名）が同じなら上書き
//    ・書き込みできるのは、データベース側の「管理者名簿」にいる人だけ（画面で隠すだけではない）
//    ・消す機能は無い

import { supabase } from "./supabaseClient";

const AUDIO_BUCKET = "bird-wav";
const IMAGE_BUCKET = "bird-images";
const CONFLICT_COLUMNS = "wav_filename,start_sec,end_sec,scientific_name";
const INSERT_BATCH_SIZE = 500;
const SAFE_FILE_NAME = /^[A-Za-z0-9._-]+$/;

// ---------- CSV を読む ----------

// 引用符（"）・改行・BOM に対応した、簡易の CSV 読み込み。行ごとに、列の配列を返す
export function parseCsv(text) {
  const src = text.replace(/^﻿/, "");
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  const endRow = () => {
    row.push(field);
    field = "";
    if (row.length > 1 || row[0] !== "") rows.push(row); // 空行は飛ばす
    row = [];
  };

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      endRow();
    } else {
      field += c;
    }
  }
  if (field !== "" || row.length > 0) endRow();
  return rows;
}

const BIRDNET_COLUMNS = {
  "Start (s)": "start_sec",
  "End (s)": "end_sec",
  "Scientific name": "scientific_name",
  "Common name": "common_name",
  Confidence: "confidence",
  File: "file",
};
const REQUIRED_COLUMNS = ["Start (s)", "End (s)", "Scientific name", "Confidence", "File"];

// BirdNET の CSV（Batch analysis の出力）を、記録の配列にする。
//   戻り値：{ rows: [{ start_sec, end_sec, scientific_name, common_name, confidence, file }], skipped, error }
export function parseBirdnetCsv(text) {
  const table = parseCsv(text);
  if (table.length === 0) return { rows: [], skipped: 0, error: "中身が空です。" };

  const header = table[0].map((h) => h.trim());
  const missing = REQUIRED_COLUMNS.filter((c) => !header.includes(c));
  if (missing.length > 0) {
    return { rows: [], skipped: 0, error: `BirdNET の CSV ではないようです（見つからない列：${missing.join("、")}）。` };
  }

  const index = {};
  header.forEach((h, i) => {
    if (BIRDNET_COLUMNS[h]) index[BIRDNET_COLUMNS[h]] = i;
  });

  const rows = [];
  let skipped = 0;
  for (const cells of table.slice(1)) {
    const start = Number(cells[index.start_sec]);
    const end = Number(cells[index.end_sec]);
    const confidence = Number(cells[index.confidence]);
    const scientific = (cells[index.scientific_name] ?? "").trim();
    const file = (cells[index.file] ?? "").trim();
    if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(confidence) || !scientific || !file) {
      skipped++;
      continue;
    }
    const common = index.common_name != null ? (cells[index.common_name] ?? "").trim() : "";
    rows.push({
      start_sec: start,
      end_sec: end,
      scientific_name: scientific,
      common_name: common || null,
      confidence,
      file,
    });
  }
  return { rows, skipped, error: null };
}

// ---------- CSV の File 列 → MP3 の名前 ----------
//   CSV 側は「260809_036」（YYMMDD_nnn）、MP3 側は「260809_036_0741.mp3」（hhmm 付き）なので、
//   先頭10文字が同じものを、対応する MP3 とみなす（Streamlit と同じ）

export function fileKey(fileColumn) {
  const base = fileColumn.split(/[\\/]/).pop() ?? fileColumn;
  const dot = base.lastIndexOf(".");
  return (dot > 0 ? base.slice(0, dot) : base).slice(0, 10);
}

// availableNames：今回選んだ MP3 の名前（先に）＋保存場所にすでにある MP3 の名前
export function matchMp3Name(fileColumn, availableNames) {
  const key = fileKey(fileColumn);
  const hits = availableNames.filter((n) => n.endsWith(".mp3") && n.slice(0, 10) === key);
  return { name: hits[0] ?? null, ambiguous: new Set(hits).size > 1, key };
}

// ---------- 登録の準備（確認画面用。何も書き込まない） ----------

// csvTexts：[{ name, text }]、selectedMp3Names：今回選んだ MP3 の名前、storageNames：すでに保存場所にある名前
export function buildImportPreview({ csvTexts, selectedMp3Names, storageNames }) {
  const available = [...new Set([...selectedMp3Names, ...storageNames])];
  const perFile = [];
  const records = new Map(); // 重複（同じ記録）を、後のものに置き換えてまとめる
  const unmatched = new Set();
  const ambiguous = new Set();
  let duplicates = 0;

  for (const { name, text } of csvTexts) {
    const parsed = parseBirdnetCsv(text);
    if (parsed.error) {
      perFile.push({ name, error: parsed.error, rows: 0, skipped: 0, species: 0 });
      continue;
    }
    const species = new Set();
    for (const r of parsed.rows) {
      const match = matchMp3Name(r.file, available);
      if (!match.name) unmatched.add(match.key);
      if (match.ambiguous) ambiguous.add(match.key);
      const wav = match.name ?? `${r.file.split(/[\\/]/).pop().replace(/\.[^.]+$/, "")}.mp3`;
      const record = {
        wav_filename: wav,
        start_sec: r.start_sec,
        end_sec: r.end_sec,
        scientific_name: r.scientific_name,
        common_name: r.common_name,
        confidence: r.confidence,
      };
      const dedupeKey = `${wav}__${r.start_sec}__${r.end_sec}__${r.scientific_name}`;
      if (records.has(dedupeKey)) duplicates++;
      records.set(dedupeKey, record);
      species.add(r.scientific_name);
    }
    perFile.push({ name, error: null, rows: parsed.rows.length, skipped: parsed.skipped, species: species.size });
  }

  const unsafeMp3Names = selectedMp3Names.filter((n) => !SAFE_FILE_NAME.test(n));
  return {
    perFile,
    records: [...records.values()],
    unmatchedKeys: [...unmatched].sort(),
    ambiguousKeys: [...ambiguous].sort(),
    duplicates,
    unsafeMp3Names,
    speciesCount: new Set([...records.values()].map((r) => r.scientific_name)).size,
    hasCsvError: perFile.some((f) => f.error),
  };
}

// ---------- 保存場所にあるファイル名・場所・鳥の一覧 ----------

export async function listStorageFileNames(bucket = AUDIO_BUCKET) {
  const names = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase.storage
      .from(bucket)
      .list("", { limit: pageSize, offset, sortBy: { column: "name", order: "asc" } });
    if (error) throw error;
    names.push(...(data ?? []).map((f) => f.name));
    if (!data || data.length < pageSize) break;
  }
  return names;
}

// これまでの場所（座標つき）。既存の場所を選ぶと、座標が自動で入るようにするため
export async function fetchLocationChoices() {
  const { data, error } = await supabase
    .from("detections")
    .select("location_name, latitude, longitude")
    .not("latitude", "is", null)
    .not("longitude", "is", null)
    .limit(20000);
  if (error) throw error;
  const seen = new Map();
  for (const d of data ?? []) {
    if (d.location_name && !seen.has(d.location_name)) {
      seen.set(d.location_name, { name: d.location_name, latitude: d.latitude, longitude: d.longitude });
    }
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name, "ja"));
}

async function countDetections() {
  const { count, error } = await supabase.from("detections").select("id", { count: "exact", head: true });
  if (error) throw error;
  return count ?? 0;
}

// ---------- 登録する ----------
//   ① MP3 を保存（同じ名前は上書き）→ ② 記録を登録（同じ記録は上書き）
//   MP3 が1つでも失敗したら、記録は登録しない（音声の無い記録が増えないように）。やり直しても安全（上書きのため）
//   onProgress({ stage, done, total })

// MP3 を、保管場所（bird-wav）に保存する（同じ名前は上書き）。失敗したものは failed に入る
export async function uploadMp3Files(mp3Files, onProgress) {
  const failed = [];
  for (let i = 0; i < mp3Files.length; i++) {
    onProgress?.({ stage: "mp3", done: i, total: mp3Files.length });
    const file = mp3Files[i];
    const { error } = await supabase.storage
      .from(AUDIO_BUCKET)
      .upload(file.name, file, { contentType: "audio/mpeg", upsert: true });
    if (error) failed.push({ name: file.name, message: error.message });
  }
  onProgress?.({ stage: "mp3", done: mp3Files.length, total: mp3Files.length });
  return failed;
}

//   extraColumns：全ての記録に付ける、追加の列（サーバー解析の、モデル名・バージョン・解析日時・設定）
export async function runImport({ mp3Files, records, location, onProgress, extraColumns = {} }) {
  const progress = (stage, done, total) => onProgress?.({ stage, done, total });
  const before = await countDetections();

  // ① MP3
  const failed = await uploadMp3Files(mp3Files, onProgress);
  if (failed.length > 0) {
    return { ok: false, mp3Saved: mp3Files.length - failed.length, failedMp3: failed, recordsSent: 0, before, after: before };
  }

  // ② 記録
  const rows = records.map((r) => ({
    ...r,
    ...extraColumns,
    location_name: location.name,
    latitude: location.latitude,
    longitude: location.longitude,
  }));
  for (let i = 0; i < rows.length; i += INSERT_BATCH_SIZE) {
    progress("records", i, rows.length);
    const batch = rows.slice(i, i + INSERT_BATCH_SIZE);
    const { error } = await supabase.from("detections").upsert(batch, { onConflict: CONFLICT_COLUMNS });
    if (error) {
      const after = await countDetections();
      return { ok: false, mp3Saved: mp3Files.length, failedMp3: [], recordsSent: i, recordError: error.message, before, after };
    }
  }
  progress("records", rows.length, rows.length);

  const after = await countDetections();
  return { ok: true, mp3Saved: mp3Files.length, failedMp3: [], recordsSent: rows.length, before, after };
}

// ---------- サーバー解析の結果を、既存の記録と比べる（登録前の確認用。何も書き込まない） ----------

// 指定した MP3 の、いまの記録
export async function fetchExistingRecords(fileNames) {
  if (fileNames.length === 0) return [];
  const { data, error } = await supabase
    .from("detections")
    .select("wav_filename, start_sec, end_sec, scientific_name, confidence")
    .in("wav_filename", fileNames)
    .limit(20000);
  if (error) throw error;
  return data ?? [];
}

// 新しい解析結果（fileName → 記録の配列）と、いまの記録を、ファイルごとに比べる。
//   new＝いまは無い（新しく増える）／same＝同じ記録で信頼度がほぼ同じ／changed＝同じ記録で信頼度が変わる（上書きされる）／
//   existingOnly＝いまはあるが、新しい結果には無い（消えずに残る）
export function compareWithExisting(results, existing) {
  const key = (r) => `${r.wav_filename}__${Number(r.start_sec)}__${Number(r.end_sec)}__${r.scientific_name}`;
  const existingMap = new Map(existing.map((r) => [key(r), r]));
  const perFile = {};
  const newKeys = new Set();
  for (const [name, res] of Object.entries(results)) {
    const c = { new: 0, same: 0, changed: 0, existingOnly: 0, existingTotal: 0 };
    for (const r of res.rows ?? []) {
      const row = { ...r, wav_filename: name };
      const k = key(row);
      newKeys.add(k);
      const old = existingMap.get(k);
      if (!old) c.new++;
      else if (Math.abs(Number(old.confidence) - r.confidence) < 0.0005) c.same++;
      else c.changed++;
    }
    perFile[name] = c;
  }
  for (const r of existing) {
    const c = perFile[r.wav_filename];
    if (!c) continue;
    c.existingTotal++;
    if (!newKeys.has(key(r))) c.existingOnly++;
  }
  return perFile;
}

// ---------- 鳥の写真 ----------

// いまの写真（あれば）。置き換わることを、登録前に見せるため
export async function fetchCurrentBirdImage(commonName) {
  const { data, error } = await supabase
    .from("bird_master")
    .select("image_url")
    .eq("common_name", commonName)
    .maybeSingle();
  if (error) throw error;
  return data?.image_url ?? null;
}

function randomHex(length) {
  const bytes = new Uint8Array(Math.ceil(length / 2));
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, length);
}

// 写真を保存して、その鳥の写真として登録する（元の写真は、そのまま保存。表示のときに縮小される）
export async function uploadBirdImage({ commonName, file }) {
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
  const stamp = new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);
  const path = `img_${stamp}_${randomHex(8)}.${ext}`;

  const { error: uploadError } = await supabase.storage.from(IMAGE_BUCKET).upload(path, file, {
    contentType: file.type || (ext === "png" ? "image/png" : "image/jpeg"),
  });
  if (uploadError) throw uploadError;

  const { data } = supabase.storage.from(IMAGE_BUCKET).getPublicUrl(path);
  const { error } = await supabase
    .from("bird_master")
    .upsert({ common_name: commonName, image_url: data.publicUrl }, { onConflict: "common_name" });
  if (error) throw error;
  return data.publicUrl;
}
