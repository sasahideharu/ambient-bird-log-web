// 🔥 録音に、「目で見た鳥」を書き足す部品。これまでの鳥の名前から選ぶ・探す・新しい名前で追加する。
//    ・これまでの鳥の名前は、ネットから取れたら、端末に覚えておく（電波が無いところでも、選べるように。lib/geo.js の loadPlaces と同じやり方）
//    ・記録先は、録音の情報（meta.eyeWitness）。まだ、サーバーには送らない（あとの「登録」の段階で、一緒に使う）

import { fetchSpeciesChoices } from "./verifications";
import { writeMeta } from "./recordingStore";

const CHOICES_KEY = "abl.species.cache";

// これまでの鳥の名前の一覧 [{ commonName, scientificName }]。ネットから取れたら、端末に覚える。取れなければ、覚えているもの
export async function loadSpeciesChoices() {
  try {
    const choices = await fetchSpeciesChoices();
    if (choices.length > 0) {
      try {
        window.localStorage.setItem(CHOICES_KEY, JSON.stringify(choices));
      } catch {
        // 覚えられない環境
      }
    }
    return choices;
  } catch {
    try {
      return JSON.parse(window.localStorage.getItem(CHOICES_KEY) ?? "[]");
    } catch {
      return [];
    }
  }
}

// 「目で見た鳥」を、録音に1件、書き足す。meta を書き換えて、保存する（戻り値：書き換えたあとの meta）
export async function addEyeWitness(meta, { commonName, scientificName = null, note = null }) {
  const name = commonName.trim();
  if (!name) throw new Error("鳥の名前を入れてください");
  const next = { ...meta, _files: undefined };
  delete next._files; // 一覧のために足した、表示用の値（記録には残さない）
  const list = Array.isArray(next.eyeWitness) ? next.eyeWitness.slice() : [];
  list.push({ commonName: name, scientificName: scientificName || null, note: note?.trim() || null, addedAt: new Date().toISOString() });
  next.eyeWitness = list;
  await writeMeta(next);
  return next;
}

// 「目で見た鳥」を、1件、取り消す（間違えて足したときに戻す）
export async function removeEyeWitness(meta, index) {
  const next = { ...meta, _files: undefined };
  delete next._files;
  const list = Array.isArray(next.eyeWitness) ? next.eyeWitness.slice() : [];
  list.splice(index, 1);
  next.eyeWitness = list;
  await writeMeta(next);
  return next;
}
