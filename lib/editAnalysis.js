// 🔥 編集した録音の解析結果（BirdNET の記録＋Perch の意見）を、鳥ごとにまとめる（書き出しの画面で使う）。
//    ・両方が一致＝BirdNET が挙げた鳥が、Perch の上位（5秒ごとの上位5種）にも入っていて、点数（logit）が 6 以上
//      （点数が低い上位は、雑音でも出るので、「一致」には数えない。録音画面のリアルタイム解析と同じ基準）
//    ・点数（logit）：確かな検出は 9〜12・雑音は 4〜7 の目安。8 以上は「強い」

import { judge } from "./modelOpinions";

export const PERCH_STRONG_LOGIT = 8;
export const PERCH_AGREE_LOGIT = 6; // これ以上の点数で、Perch の上位にもいるとき、「両方が一致」

// records：BirdNET の記録 [{ scientific_name, common_name, confidence, start_sec, end_sec }]
// perchWindows：Perch の区間 [{ t0, t1, top: [{ sci, common, logit, prob }] }]。Perch を使わなかったときは null
// 戻り値：[{ sci, name, count, best, perch: { rank, logit } | null, both }]
//   perch＝Perch の上位にもいるときの、一番よい順位と点数。both＝両方が一致（点数 6 以上）。両方が一致した鳥を上に。そのあと、信頼度の高い順
export function summarizeSpecies(records, perchWindows) {
  const bySpecies = new Map();
  for (const r of records) {
    const cur = bySpecies.get(r.scientific_name) ?? { sci: r.scientific_name, name: r.common_name || r.scientific_name, count: 0, best: 0, perch: null };
    cur.count += 1;
    cur.best = Math.max(cur.best, r.confidence);
    if (perchWindows) {
      const j = judge(r.scientific_name, perchWindows, r.start_sec, r.end_sec);
      if (j.status === "same" && (!cur.perch || j.rank < cur.perch.rank || (j.rank === cur.perch.rank && j.logit > cur.perch.logit))) {
        cur.perch = { rank: j.rank, logit: j.logit };
      }
    }
    bySpecies.set(r.scientific_name, cur);
  }
  const list = [...bySpecies.values()].map((s) => ({ ...s, both: !!s.perch && s.perch.logit >= PERCH_AGREE_LOGIT }));
  return list.sort((a, b) => Number(b.both) - Number(a.both) || b.best - a.best);
}

// Perch だけが強く言う鳥（その区間の1位・点数 8 以上・BirdNET の記録には無い）：[[名前, 点数]]（点数の高い順）
export function findPerchOnly(perchWindows, records) {
  if (!perchWindows) return [];
  const only = new Map();
  for (const w of perchWindows) {
    const t = w.top[0];
    if (!t || t.logit < PERCH_STRONG_LOGIT) continue;
    if (records.some((r) => r.scientific_name === t.sci && r.end_sec > w.t0 && r.start_sec < w.t1)) continue;
    const label = t.common ?? t.sci;
    only.set(label, Math.max(only.get(label) ?? 0, t.logit));
  }
  return [...only.entries()].sort((a, b) => b[1] - a[1]);
}
