// 🔥 種の並び順を、このページを開いている間（＝ページ内遷移をしている間）だけ覚えておく。
//    モジュールスコープの変数なので、Next.js内のページ遷移（Linkでの移動）では保持されるが、
//    ブラウザの本当のリロードが起きるとJSごと再読み込みされてリセットされる。
//    AdminHome・MinimalHome両方から同じ状態を参照することで、見た目の並び順を揃える。
let sessionOrderMap = {};

export const FIXED_TAIL_ORDER = ["ヒヨドリ", "ガビチョウ"];

export function getSessionOrderMap() {
  return sessionOrderMap;
}

export function setSessionOrderMap(next) {
  sessionOrderMap = next;
}

// keywordFiltered: name を持つ種のリスト。orderMap: 種名→ランダムな順位(0〜1)のマップ
export function sortWithFixedTail(list, orderMap) {
  const rest = list
    .filter((s) => !FIXED_TAIL_ORDER.includes(s.name))
    .slice()
    .sort((a, b) => (orderMap[a.name] ?? 0.5) - (orderMap[b.name] ?? 0.5));
  const fixedTail = FIXED_TAIL_ORDER.map((name) =>
    list.find((s) => s.name === name)
  ).filter(Boolean);
  return [...rest, ...fixedTail];
}
