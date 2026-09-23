// 🔥 学名 → 和名（BirdNET のラベル・約6500種）。古い録音（和名をまだ保存していなかった版で記録した、
//    リアルタイム解析の結果）でも、日本語で出せるようにする。
//    ・public/species-ja.json は、アプリの中に入っているので、電波が無くても読める
//    ・一度読んだら、覚えておく（次からは、すぐ返す）

let cache = null; // Map（学名 → 和名）。読み込み中は、その Promise

export function loadSpeciesJaNames() {
  if (cache) return cache;
  cache = fetch("/species-ja.json")
    .then((res) => {
      if (!res.ok) throw new Error(`status ${res.status}`);
      return res.json();
    })
    .then((obj) => new Map(Object.entries(obj)))
    .catch((err) => {
      console.warn("学名→和名の一覧を読み込めませんでした", err);
      cache = null; // 次に呼ばれたときに、もう一度試す
      return new Map();
    });
  return cache;
}
