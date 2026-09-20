// 🔥 解析サーバー（Modal）を呼ぶ。保管場所（bird-wav）にある MP3 を、名前で指定して、BirdNET で解析してもらう。
//    ・サーバーは、結果を返すだけ（記録は書き込まない）。書き込みは、画面（ログイン中の管理者）が行う
//    ・ログインのトークンを添えて呼ぶ。サーバーが、Supabase に問い合わせて、管理者か確かめる

import { supabase, SUPABASE_PUBLIC_KEY } from "./supabaseClient";
import { ANALYZER_URL, ANALYZER_MAX_FILES } from "./analyzerConfig";

async function readError(res) {
  try {
    const body = await res.json();
    if (typeof body?.detail === "string") return body.detail;
    if (Array.isArray(body?.detail)) return "入力が正しくありません";
  } catch {
    // 中身が読めないときは、状態番号だけ伝える
  }
  return `サーバーがエラーを返しました（${res.status}）`;
}

// names：MP3 の名前の一覧。location：{ lat, lon } か null（絞り込みなし）
// stereo："best"（標準）＝ステレオは、左右も別々に解析して、強い方を採る／"mix"＝左右を混ぜた音だけ（Mac の BirdNET の画面と同じ）
// perch：True なら、別のモデル Perch も動かして、5秒ごとの上位5種を、results[名前].perch に入れる（場所の指定が、要る）
// birdnet：False なら、BirdNET を動かさない（Perch だけ）
// 戻り値：{ results: { 名前: { rows, week, perch?, error? } }, warnings, meta（meta.perch＝Perch の情報）, elapsedSec }
export async function analyzeMp3Files({ names, minConf, location, useWeek, stereo = "best", perch = false, birdnet = true, onProgress }) {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) throw new Error("ログインが必要です。ログインし直してください。");

  const results = {};
  const warnings = [];
  let meta = null;
  let elapsedSec = 0;

  for (let i = 0; i < names.length; i += ANALYZER_MAX_FILES) {
    onProgress?.({ stage: "analyze", done: i, total: names.length });
    const chunk = names.slice(i, i + ANALYZER_MAX_FILES);
    let res;
    try {
      res = await fetch(`${ANALYZER_URL}/analyze`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          apikey: SUPABASE_PUBLIC_KEY,
        },
        body: JSON.stringify({ files: chunk, min_conf: minConf, location: location ?? null, use_week: useWeek, stereo, perch, birdnet }),
      });
    } catch (err) {
      console.error(err);
      throw new Error("解析サーバーにつながりませんでした。通信を確認して、もう一度お試しください。");
    }
    if (!res.ok) throw new Error(await readError(res));

    const body = await res.json();
    Object.assign(results, body.results);
    warnings.push(...(body.warnings ?? []));
    meta = body.meta; // モデル名などは、どの回も同じ（Perch の情報も）
    elapsedSec += body.elapsed_sec ?? 0;
  }
  onProgress?.({ stage: "analyze", done: names.length, total: names.length });
  return { results, warnings, meta, elapsedSec };
}
