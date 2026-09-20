"use client";

import { useState } from "react";
import Link from "next/link";
import VerifyPanel from "./VerifyPanel";
import { editedSourceOf } from "../lib/parseWav";

// 🔥 録音1件の下に出す、修正・確定の表示と操作。
//    ・「確定」「修正済み（元：○○）」「編集（元：○○）」の印は、ログインしていない人にも見える
//      （編集＝音声の編集画面で、範囲を絞って書き出した録音。名前が <元の名前>_e連番.mp3）
//    ・「確認する」「編集する」は、ログイン中の本人だけ（編集する＝音声の編集画面 /edit へ）。
//      編集で書き出した録音には、「編集する」は出さない（さらに編集して公開することは、しない）
//    tone: 暗い背景（ホームの詳細）＝"dark"、明るい背景（管理画面・鳥・地点・日のページ）＝"light"
export default function VerifyControl({ record, loggedIn, onSaved, tone = "light" }) {
  const [open, setOpen] = useState(false);
  const v = record.verification;
  const dark = tone === "dark";

  const badge =
    v?.status === "confirmed"
      ? "確定"
      : v?.status === "corrected"
        ? `修正済み（元：${record.originalCommonName}）`
        : null;

  const editedFrom = editedSourceOf(record.wavFilename); // 編集で書き出した録音なら、元の録音の名前

  if (!badge && !editedFrom && !loggedIn) return null;

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {badge && (
        <span
          className={`text-[10px] font-bold rounded-full px-2.5 py-1 ${
            dark ? "bg-[#B8E0C0]/20 text-[#B8E0C0]" : "bg-[#DDEBDD] text-[#3F6C3F]"
          }`}
        >
          ✓ {badge}
        </span>
      )}
      {editedFrom && (
        <span
          className={`text-[10px] font-bold rounded-full px-2.5 py-1 break-all ${
            dark ? "bg-white/10 text-white/70" : "bg-[#E4EEF0] text-[#3F6C74]"
          }`}
        >
          ✂ 編集（元：{editedFrom.replace(/\.mp3$/, "")}）
        </span>
      )}
      {loggedIn && (
        <button
          onClick={() => setOpen(true)}
          className={`text-[10px] font-bold underline underline-offset-2 ${
            dark ? "text-white/55 hover:text-white" : "text-[#3F6C74] hover:text-[#2c4f55]"
          }`}
        >
          {v ? "判断を変える" : "確認する"}
        </button>
      )}
      {loggedIn && !editedFrom && (
        <Link
          href={`/edit?name=${encodeURIComponent(record.wavFilename)}&start=${record.startSec}&end=${record.endSec}`}
          className={`text-[10px] font-bold underline underline-offset-2 ${
            dark ? "text-white/55 hover:text-white" : "text-[#3F6C74] hover:text-[#2c4f55]"
          }`}
        >
          編集する
        </Link>
      )}
      {loggedIn && open && (
        <VerifyPanel open={open} record={record} onClose={() => setOpen(false)} onSaved={onSaved} />
      )}
    </div>
  );
}
