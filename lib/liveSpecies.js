// 🔥 リアルタイム解析の結果を、種ごとにまとめる（録音画面の「BirdNET（左）・Perch（右）」の表示に使う）。
//    ・BirdNET：サーバーが、下限（0.25）以上の種だけを返す
//    ・Perch：最後の5秒の上位5種のうち、点数（logit）が PERCH_SHOW_LOGIT 以上のものだけを「出た」とする
//      （確かな検出は 9〜12・雑音は 4〜7 の目安。8 以上を「強い」とする＝ServerAnalyzeSection と同じ）
//    ・両方が、近い時刻（5秒以内）に、同じ種（学名）を挙げたら「一致」

export const PERCH_SHOW_LOGIT = 6;
export const PERCH_STRONG_LOGIT = 8;
export const AGREE_WITHIN_SEC = 5;
const RECENT_SEC = 6; // 直近（「今」と表示する）とみなす長さ

export function emptyLive() {
  return { species: {}, windows: 0 };
}

// state に、サーバーの結果（onResult の引数）を足した、新しい state を返す
export function mergeLive(state, result) {
  const species = { ...state.species };
  const entry = (sci, common) => {
    const prev = species[sci] ?? { sci, common: null, bn: null, pc: null, agreedAtSec: null };
    const next = { ...prev, common: prev.common ?? common ?? null };
    species[sci] = next;
    return next;
  };

  for (const s of result.bn?.species ?? []) {
    const e = entry(s.sci, s.common);
    e.bn = { count: (e.bn?.count ?? 0) + 1, lastSec: result.bn.t1, conf: s.confidence, best: Math.max(e.bn?.best ?? 0, s.confidence) };
  }
  for (const t of result.pc?.top ?? []) {
    if (t.logit < PERCH_SHOW_LOGIT) continue;
    const e = entry(t.sci, t.common);
    e.pc = { count: (e.pc?.count ?? 0) + 1, lastSec: result.pc.t1, logit: t.logit, best: Math.max(e.pc?.best ?? -99, t.logit) };
  }
  for (const e of Object.values(species)) {
    if (e.bn && e.pc && Math.abs(e.bn.lastSec - e.pc.lastSec) <= AGREE_WITHIN_SEC) e.agreedAtSec = Math.max(e.bn.lastSec, e.pc.lastSec);
  }
  return { species, windows: state.windows + 1 };
}

// 表示用の並び：モデルごとに、新しく出た順。{ bn: [...], pc: [...], agreed: [...] }。各行に、agreeNow（いま一致）・agreed（これまでに一致）・recent（直近）
export function listLive(state, nowSec) {
  const rows = Object.values(state.species);
  const decorate = (e, key) => ({
    ...e,
    key,
    lastSec: e[key].lastSec,
    recent: nowSec - e[key].lastSec <= RECENT_SEC,
    agreed: e.agreedAtSec != null,
    agreeNow: e.agreedAtSec != null && nowSec - e.agreedAtSec <= RECENT_SEC,
  });
  const bn = rows.filter((e) => e.bn).map((e) => decorate(e, "bn")).sort((a, b) => b.lastSec - a.lastSec);
  const pc = rows.filter((e) => e.pc).map((e) => decorate(e, "pc")).sort((a, b) => b.lastSec - a.lastSec);
  const agreed = rows.filter((e) => e.agreedAtSec != null).sort((a, b) => b.agreedAtSec - a.agreedAtSec);
  return { bn, pc, agreed };
}

// 録音の記録（meta.live）に残す、1回ぶんの小さな形。あとで、参考にする（正式な解析ではない）
//   学名・信頼度（点数）・和名（無ければ null）の3つ組で持つ
export function compactResult(result) {
  return {
    t: Math.round(result.endSec * 10) / 10,
    b: (result.bn?.species ?? []).slice(0, 5).map((s) => [s.sci, s.confidence, s.common ?? null]),
    p: (result.pc?.top ?? []).filter((t) => t.logit >= PERCH_SHOW_LOGIT).slice(0, 3).map((t) => [t.sci, t.logit, t.common ?? null]),
  };
}

// meta.live（保存済みの、録音中のリアルタイム解析の記録）から、鳥ごとにまとめる（録音の一覧で使う。参考の表示）。
//   古い録音（和名を持たない版で保存したもの）は、和名が null になる（学名で表示する）
// 戻り値：[{ sci, common, bn: { count, best } | null, pc: { count, best } | null, agreed }]（両方が一致した鳥を上に。そのあと、点数の高い順）
export function summarizeStoredLive(liveMeta) {
  if (!liveMeta?.windows?.length) return [];
  const bySpecies = new Map();
  const entry = (sci, common) => {
    const cur = bySpecies.get(sci) ?? { sci, common: null, bn: null, pc: null };
    cur.common = cur.common ?? common ?? null;
    bySpecies.set(sci, cur);
    return cur;
  };
  for (const w of liveMeta.windows) {
    for (const [sci, conf, common] of w.b ?? []) {
      const e = entry(sci, common);
      e.bn = { count: (e.bn?.count ?? 0) + 1, best: Math.max(e.bn?.best ?? 0, conf) };
    }
    for (const [sci, logit, common] of w.p ?? []) {
      const e = entry(sci, common);
      e.pc = { count: (e.pc?.count ?? 0) + 1, best: Math.max(e.pc?.best ?? -99, logit) };
    }
  }
  const list = [...bySpecies.values()].map((e) => ({ ...e, agreed: !!(e.bn && e.pc) }));
  return list.sort((a, b) => Number(b.agreed) - Number(a.agreed) || (b.bn?.best ?? -1) - (a.bn?.best ?? -1));
}
