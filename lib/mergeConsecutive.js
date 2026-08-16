// 🔥 Streamlit版にあった merge_consecutive_detections の移植。
//    同じファイル・同じ鳥の検出結果を開始時刻順に並べ、前の検出の終了時刻と
//    次の検出の開始時刻の差がmaxGap秒以内なら、1つの長い区間として連結する。
//    （BirdNETは3秒ごとに解析するため、同じ鳴き声が複数の3秒チャンクに
//    分かれて検出されてしまうのを防ぐための処理）
export function mergeConsecutiveDetections(detections, maxGap = 3.0) {
  const groups = new Map();
  for (const d of detections) {
    const key = `${d.wav_filename}__${d.common_name}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(d);
  }

  const merged = [];
  for (const rows of groups.values()) {
    const sorted = rows
      .slice()
      .sort((a, b) => Number(a.start_sec) - Number(b.start_sec));

    let current = null;
    for (const row of sorted) {
      const start = Number(row.start_sec);
      const end = Number(row.end_sec);
      const confidence = Number(row.confidence);

      if (!current) {
        current = { ...row, start_sec: start, end_sec: end, confidence };
        continue;
      }

      const gap = start - current.end_sec;
      if (gap <= maxGap) {
        // 連結：開始時刻は最初のもの、終了時刻は一番遅いもの、信頼度は一番高いものを採用
        current.end_sec = Math.max(current.end_sec, end);
        current.confidence = Math.max(current.confidence, confidence);
      } else {
        merged.push(current);
        current = { ...row, start_sec: start, end_sec: end, confidence };
      }
    }
    if (current) merged.push(current);
  }

  return merged;
}
