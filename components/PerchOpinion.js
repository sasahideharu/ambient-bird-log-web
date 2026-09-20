"use client";

import { useEffect, useState } from "react";
import { fetchOpinions, judge } from "../lib/modelOpinions";

const TOP_SHOWN = 3; // 区間ごとに見せる上位の数
const WINDOWS_SHOWN = 6; // 見せる区間の数（長く続く記録は、まとめて1件になっているため、多いことがある）

const sec = (v) => Number(v).toFixed(v % 1 === 0 ? 0 : 1);

// 🔥 確認画面に出す「別モデル（Perch）の意見」（管理者だけ。データベース側で、管理者名簿にいる人にしか渡さない）。
//    その記録の時間に重なる、Perch の5秒ごとの区間で、上位の鳥を並べて、BirdNET の鳥が入っているかを示す。
//    点数は logit（確かな検出は 9〜12・雑音は 4〜7 の目安。確率ではない）
//    scientificName／commonName：BirdNET が判定した鳥（判断で直す前の、元の判定）
export default function PerchOpinion({ wavFilename, startSec, endSec, scientificName, commonName }) {
  const [state, setState] = useState({ loading: true, windows: [], failed: false });

  useEffect(() => {
    let alive = true;
    setState({ loading: true, windows: [], failed: false });
    fetchOpinions(wavFilename, startSec, endSec)
      .then((windows) => alive && setState({ loading: false, windows, failed: false }))
      .catch((err) => {
        console.error(err);
        if (alive) setState({ loading: false, windows: [], failed: true });
      });
    return () => {
      alive = false;
    };
  }, [wavFilename, startSec, endSec]);

  if (state.failed) return null; // 読めなかった（表が無い・権限が無い）ときは、何も出さない

  const box = "mt-4 rounded-xl bg-white/8 border border-white/15 px-4 py-3";
  const title = <div className="text-[11px] font-bold text-white/80">別モデル（Perch）の意見</div>;

  if (state.loading) {
    return (
      <div className={box}>
        {title}
        <p className="mt-1 text-[11px] text-white/50">確認中…</p>
      </div>
    );
  }
  if (state.windows.length === 0) {
    return (
      <div className={box}>
        {title}
        <p className="mt-1 text-[11px] text-white/50 leading-relaxed">
          まだありません（管理画面の「Perch」で、この録音にかけられます）。
        </p>
      </div>
    );
  }

  const j = judge(scientificName, state.windows, startSec, endSec);
  return (
    <div className={box}>
      {title}
      <p className={`mt-1 text-[11px] leading-relaxed ${j.status === "same" ? "text-[#B8E0C0]" : "text-[#F5D9A8]"}`}>
        {j.status === "same"
          ? `✓ ${commonName} が、Perch の上位にもいます（${j.rank}位・点数 ${Number(j.logit).toFixed(1)}）`
          : `△ ${commonName} は、Perch の上位${state.windows[0].top.length}種に入っていません（別の鳥の可能性も、確かめてください）`}
      </p>
      <ul className="mt-2 flex flex-col gap-1.5">
        {state.windows.slice(0, WINDOWS_SHOWN).map((w) => (
          <li key={w.t0} className="text-[11px] text-white/70 leading-relaxed">
            <span className="text-white/45">
              {sec(w.t0)}〜{sec(w.t1)}秒：
            </span>
            {w.top.slice(0, TOP_SHOWN).map((t, i) => (
              <span key={t.sci}>
                {i > 0 && "・"}
                <span className={t.sci === scientificName ? "font-bold text-[#B8E0C0]" : ""}>
                  {t.common ?? t.sci} {Number(t.logit).toFixed(1)}
                </span>
              </span>
            ))}
          </li>
        ))}
        {state.windows.length > WINDOWS_SHOWN && (
          <li className="text-[11px] text-white/45">ほか {state.windows.length - WINDOWS_SHOWN}区間（判定は、全部の区間を見ています）</li>
        )}
      </ul>
      <p className="mt-2 text-[10px] text-white/40 leading-relaxed">
        点数は、確率ではありません（確かな検出は 9〜12、雑音は 4〜7 が目安）。場所・時期で、いない鳥は除いてあります。
      </p>
    </div>
  );
}
