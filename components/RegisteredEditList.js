"use client";

import { useEffect, useRef, useState } from "react";
import { getAudioUrl } from "../lib/queries";
import AudioEditor from "./AudioEditor";

const cardClass = "bg-white border-[3px] border-cardBorder rounded-2xl p-4";
const btnClass =
  "rounded-full border-2 border-cardBorder bg-page px-3 py-1 text-[11px] font-bold text-[#3F6C74] hover:border-accent disabled:opacity-40";

const SHOWN_PER_FILE = 5; // 最初に見せる検出の数（信頼度の高い順）

const sec = (v) => `${Number(v).toFixed(v % 1 === 0 ? 0 : 1)}`;

// 🔥 登録が終わった録音の「編集する」の一覧（データ登録の画面・管理者だけ）。
//    登録した録音ごとに、検出された鳥（時間・信頼度）を並べる。「編集する」を押すと、この下に、編集画面が開く
//    （その検出の時間が、範囲として選ばれた状態。保存・書き出し・解析・公開は、ふだんの編集画面と同じ）。
//    開く編集画面は、一度に1つだけ。
//    files：[{ name（録音の名前）, rows：[{ start_sec, end_sec, common_name, confidence }] }]
export default function RegisteredEditList({ files }) {
  const [open, setOpen] = useState(null); // { name, start, end, nonce }
  const [showAll, setShowAll] = useState({}); // 名前 → 全部見せる
  const editorRef = useRef(null);

  // 編集画面を開いたら、そこまで画面を動かす
  useEffect(() => {
    if (open) editorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [open]);

  if (!files || files.length === 0) return null;

  const openEditor = (name, start = null, end = null) => setOpen({ name, start, end, nonce: Date.now() });

  return (
    <>
      <div className={cardClass}>
        <div className="text-xs font-bold text-ink mb-1">✂ 登録した録音を編集する</div>
        <p className="text-[11px] text-inkMuted leading-relaxed">
          鳥の声の部分だけを取り出して、聞き比べたり、別の録音として公開したりできます（公開すると、ふつうの録音と同じように数えられます）。保存していない範囲は、別の録音や範囲を開くと、消えます。
        </p>

        <ul className="mt-3 flex flex-col gap-3">
          {files.map((f) => {
            const rows = [...f.rows].sort((a, b) => b.confidence - a.confidence);
            const shown = showAll[f.name] ? rows : rows.slice(0, SHOWN_PER_FILE);
            return (
              <li key={f.name} className="border-t border-cardBorder pt-3 first:border-0 first:pt-0">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-[11px] font-bold text-ink break-all">{f.name}</div>
                  <button onClick={() => openEditor(f.name)} className={btnClass}>
                    全体を開く
                  </button>
                </div>
                <ul className="mt-1.5 flex flex-col gap-1">
                  {shown.map((r, i) => (
                    <li key={`${r.start_sec}-${r.end_sec}-${r.common_name}-${i}`} className="flex items-center justify-between gap-2 text-[11px] text-inkMuted">
                      <span className="min-w-0">
                        <b className="text-ink">{r.common_name || "（名前なし）"}</b>　{sec(r.start_sec)}〜{sec(r.end_sec)}秒・{Math.round(r.confidence * 100)}%
                      </span>
                      <button onClick={() => openEditor(f.name, r.start_sec, r.end_sec)} className={`${btnClass} shrink-0`}>
                        編集する
                      </button>
                    </li>
                  ))}
                </ul>
                {rows.length > SHOWN_PER_FILE && (
                  <button
                    onClick={() => setShowAll((prev) => ({ ...prev, [f.name]: !prev[f.name] }))}
                    className="mt-1.5 text-[11px] font-bold text-[#3F6C74] underline underline-offset-2"
                  >
                    {showAll[f.name] ? "少なくする" : `ほか ${rows.length - SHOWN_PER_FILE}件を見る`}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      {open && (
        <div ref={editorRef} className="flex flex-col gap-3 scroll-mt-4">
          <div className="flex items-center justify-between gap-2 px-1">
            <div className="text-xs font-bold text-ink break-all">✂ 編集中：{open.name}</div>
            <button onClick={() => setOpen(null)} className={btnClass}>
              閉じる
            </button>
          </div>
          <AudioEditor
            key={`${open.name}|${open.start}|${open.end}|${open.nonce}`}
            src={getAudioUrl(open.name)}
            file={null}
            initialRange={open.start != null && open.end > open.start ? { start: open.start, end: open.end } : null}
            sourceName={open.name}
          />
        </div>
      )}
    </>
  );
}
