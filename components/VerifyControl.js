"use client";

import { useState } from "react";
import Link from "next/link";
import VerifyPanel from "./VerifyPanel";

// 🔥 録音1件の下に出す、修正・確定の表示と操作。
//    ・「確定」「修正済み（元：○○）」の印は、ログインしていない人にも見える
//    ・「確認する」「編集する」は、ログイン中の本人だけ（編集する＝音声の編集画面 /edit へ）
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

  if (!badge && !loggedIn) return null;

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
      {loggedIn && (
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
