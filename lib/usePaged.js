"use client";

import { useEffect, useState } from "react";
import { isEditedName } from "./audioEdits";

// 🔥 野鳥の詳細画面（ホームの鳥の窓・/bird）の、記録の並べ方と、「さらに表示」
export const PAGE_SIZE = 5; // 最初に出す件数と、「さらに表示」で足す件数

// 編集して公開した録音（名前が _e連番.mp3）の記録か
export const isEditedRecord = (r) => isEditedName(r.wavFilename);

// 編集して公開した録音の記録を、いちばん上に。それぞれの中の並びは、そのまま（順番を保つ）
export function editedFirst(records) {
  const edited = [];
  const others = [];
  for (const r of records) (isEditedRecord(r) ? edited : others).push(r);
  return [...edited, ...others];
}

// items のうち、最初の PAGE_SIZE 件だけ出す。showMore() で、さらに PAGE_SIZE 件ずつ増やす。
// resetKey（鳥の名前など）が変わったら、最初の件数に戻す
export function usePaged(items, resetKey) {
  const [count, setCount] = useState(PAGE_SIZE);
  useEffect(() => {
    setCount(PAGE_SIZE);
  }, [resetKey]);
  return {
    shown: items.slice(0, count),
    remaining: Math.max(0, items.length - count),
    showMore: () => setCount((c) => c + PAGE_SIZE),
  };
}
