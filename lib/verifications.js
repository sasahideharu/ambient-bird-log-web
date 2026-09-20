// 🔥 修正・確定（人の判断）。BirdNET の解析結果（detections）は、取り込みのたびに上書きされるため、
//    人の判断は別の表（verifications）に持つ。表示するときに、記録に重ねて反映する。
//
//   status: "confirmed"（確定＝この鳥で合っている）／"corrected"（修正＝別の鳥だった）／"rejected"（除外＝誤検出）
//   method: "heard"（耳）／"seen"（目）／"photo"（写真）※ログイン中の本人だけに見える
//
//   判断した結果（鳥の名前・確定の印）は、ログインしていない人にも見える。根拠（method）とメモ（note）は本人だけ。
//   表がまだ無い・読めないときは、判断なしとして扱う（画面は今までどおり動く）。

import { supabase } from "./supabaseClient";
import { hasLoginSession } from "./auth";

export const VERIFY_STATUS = {
  confirmed: "確定",
  corrected: "修正済み",
  rejected: "除外",
};

export const VERIFY_METHODS = [
  { value: "heard", label: "耳で聞いた" },
  { value: "seen", label: "目で見た" },
  { value: "photo", label: "写真で確認" },
];

const PUBLIC_COLUMNS =
  "wav_filename, start_sec, end_sec, original_scientific_name, original_common_name, status, verified_scientific_name, verified_common_name";
const MEMBER_COLUMNS = `${PUBLIC_COLUMNS}, id, method, note`;
const CONFLICT_COLUMNS = "verified_by,wav_filename,start_sec,end_sec,original_scientific_name";
const EDGE_TOLERANCE_SEC = 0.05;

// ---------- 取得 ----------

export async function fetchVerificationsRemote() {
  try {
    const columns = (await hasLoginSession()) ? MEMBER_COLUMNS : PUBLIC_COLUMNS;
    const { data, error } = await supabase.from("verifications").select(columns).limit(10000);
    if (error) throw error;
    return data ?? [];
  } catch (err) {
    console.warn("修正・確定のデータを取得できませんでした（表がまだ無い場合など）。判断なしとして表示します", err);
    return [];
  }
}

// ---------- 記録に重ねる ----------
//   rows: 連続した検出を結合済みの記録。ファイル名・元の鳥・区間の重なりで、判断を探す
//   ・除外 → 記録を消す
//   ・確定／修正 → 人が確認済みなので、信頼度を100%（1.0）にして、信頼度フィルタで消えないようにする。
//     修正は、鳥の名前も差し替える。元の鳥・元の信頼度は original_* に残す（あとで編集できるように）

function overlap(aStart, aEnd, bStart, bEnd) {
  return Math.min(aEnd, bEnd) - Math.max(aStart, bStart);
}

// ファイル名＋元の鳥で判断を探せるようにしておく
function indexVerifications(verifications) {
  const byKey = new Map();
  for (const v of verifications) {
    const key = `${v.wav_filename}__${v.original_scientific_name}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(v);
  }
  return byKey;
}

// この記録に付いている判断を1つ返す（区間が最も重なるもの）。無ければ null
function findVerification(byKey, row) {
  const candidates = byKey.get(`${row.wav_filename}__${row.scientific_name}`) ?? [];
  let best = null;
  let bestOverlap = -Infinity;
  for (const v of candidates) {
    const o = overlap(Number(row.start_sec), Number(row.end_sec), Number(v.start_sec), Number(v.end_sec));
    if (o >= -EDGE_TOLERANCE_SEC && o > bestOverlap) {
      best = v;
      bestOverlap = o;
    }
  }
  return best;
}

function verificationInfo(v) {
  return { id: v.id ?? null, status: v.status, method: v.method ?? null, note: v.note ?? null };
}

export function applyVerifications(rows, verifications) {
  if (!verifications || verifications.length === 0) return rows;

  const byKey = indexVerifications(verifications);
  const result = [];
  for (const row of rows) {
    const best = findVerification(byKey, row);
    if (!best) {
      result.push(row);
      continue;
    }
    if (best.status === "rejected") continue; // 誤検出：一覧から消す

    const base = {
      ...row,
      original_common_name: row.common_name,
      original_scientific_name: row.scientific_name,
      original_confidence: row.confidence,
      confidence: 1,
      verification: verificationInfo(best),
    };
    if (best.status === "corrected") {
      base.common_name = best.verified_common_name;
      base.scientific_name = best.verified_scientific_name ?? null;
    }
    result.push(base);
  }
  return result;
}

// 「除外した記録」だけを取り出す（除外を取り消して、一覧に戻すための画面で使う）。
// 鳥の名前・信頼度は BirdNET の元のまま。verification.id で、判断を取り消せる
export function pickRejected(rows, verifications) {
  if (!verifications || verifications.length === 0) return [];

  const byKey = indexVerifications(verifications.filter((v) => v.status === "rejected"));
  const result = [];
  for (const row of rows) {
    const best = findVerification(byKey, row);
    if (!best) continue;
    result.push({
      ...row,
      original_common_name: row.common_name,
      original_scientific_name: row.scientific_name,
      original_confidence: row.confidence,
      verification: verificationInfo(best),
    });
  }
  return result;
}

// 除外した件数（管理画面の入口を出すかの判断に使う。ログイン中だけ読める列 id を使う）
export async function countRejectedRemote() {
  try {
    const { count, error } = await supabase
      .from("verifications")
      .select("id", { count: "exact", head: true })
      .eq("status", "rejected");
    if (error) throw error;
    return count ?? 0;
  } catch (err) {
    console.warn("除外した件数を取得できませんでした", err);
    return 0;
  }
}

// ---------- 保存・取り消し（ログイン中の本人だけ） ----------
//   record: toRecord() で作った表示用の記録（元の鳥は originalCommonName／originalScientificName）

export async function saveVerification({
  record,
  status,
  verifiedCommonName = null,
  verifiedScientificName = null,
  method = null,
  note = null,
}) {
  const row = {
    wav_filename: record.wavFilename,
    start_sec: record.startSec,
    end_sec: record.endSec,
    original_scientific_name: record.originalScientificName,
    original_common_name: record.originalCommonName,
    status,
    verified_common_name: status === "corrected" ? verifiedCommonName : null,
    verified_scientific_name: status === "corrected" ? verifiedScientificName : null,
    method: status === "rejected" ? null : method,
    note: note && note.trim() ? note.trim() : null,
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase.from("verifications").upsert(row, { onConflict: CONFLICT_COLUMNS });
  if (error) throw error;
}

export async function deleteVerification(verificationId) {
  const { error } = await supabase.from("verifications").delete().eq("id", verificationId);
  if (error) throw error;
}

// ---------- 「別の鳥だった」で選べる鳥の一覧 ----------
//   これまでに検出された鳥（元の名前）と、修正で使った名前を、まとめて重複なく並べる

let speciesChoicesCache = null;

export async function fetchSpeciesChoices() {
  if (speciesChoicesCache) return speciesChoicesCache;
  const choices = new Map(); // 和名 → 学名
  try {
    const { data } = await supabase.from("detections").select("common_name, scientific_name").limit(10000);
    for (const d of data ?? []) {
      if (d.common_name && !choices.has(d.common_name)) choices.set(d.common_name, d.scientific_name ?? null);
    }
    const { data: verified } = await supabase
      .from("verifications")
      .select("verified_common_name, verified_scientific_name")
      .eq("status", "corrected");
    for (const v of verified ?? []) {
      if (v.verified_common_name && !choices.has(v.verified_common_name)) {
        choices.set(v.verified_common_name, v.verified_scientific_name ?? null);
      }
    }
  } catch (err) {
    console.warn("鳥の一覧を取得できませんでした", err);
  }
  speciesChoicesCache = [...choices.entries()]
    .map(([commonName, scientificName]) => ({ commonName, scientificName }))
    .sort((a, b) => a.commonName.localeCompare(b.commonName, "ja"));
  return speciesChoicesCache;
}

// 修正で新しい名前が増えたときに、次に開いたとき一覧に出るようにする
export function resetSpeciesChoices() {
  speciesChoicesCache = null;
}
