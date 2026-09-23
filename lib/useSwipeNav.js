"use client";

import { useCallback, useMemo, useRef, useState } from "react";

const THRESHOLD = 0.28; // 画面の横幅の、これだけの割合を動かしたら、移動が決まる（指を離したとき）
const MAX_DRAG_RATIO = 0.75; // 指を、これ以上（画面の横幅に対する割合）動かしても、それ以上は追従しない

// 🔥 横スワイプで、次の画面へ移動する部品（録音画面 ⇄ トップページ）。
//    direction："left"（指を右→左へ動かす＝画面が左へめくれる）｜"right"（左→右）
//    enabled：false の間は、何もしない（録音中など）／onCommit：指を離して、しきい値を超えていたときに、1回だけ呼ばれる
//    戻り値：dragPercent（0〜1・指の動きに応じて、なめらかに増える。CSS の transform に使う）・dragging（動かしている最中か）・handlers（要素に渡す onPointerDown など）
export function useSwipeNav({ direction, enabled = true, onCommit }) {
  const [dragPercent, setDragPercent] = useState(0);
  const [dragging, setDragging] = useState(false);
  const startRef = useRef(null); // { x, y, width }
  const draggingAxisRef = useRef(null); // "x"（横に動かしている）｜"y"（縦スクロールとみなして、無視する）｜null（まだ決めていない）

  const reset = useCallback(() => {
    startRef.current = null;
    draggingAxisRef.current = null;
    setDragging(false);
    setDragPercent(0);
  }, []);

  const onPointerDown = useCallback(
    (e) => {
      if (!enabled || e.pointerType === "mouse") return; // マウスのドラッグは、対象外（指・ペンだけ）
      startRef.current = { x: e.clientX, y: e.clientY, width: window.innerWidth || 1 };
      draggingAxisRef.current = null;
    },
    [enabled]
  );

  const onPointerMove = useCallback(
    (e) => {
      const start = startRef.current;
      if (!start) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (!draggingAxisRef.current) {
        // 最初の少しの動きで、横向き（スワイプ）か、縦向き（一覧などのスクロール）かを決める
        if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
        draggingAxisRef.current = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
        if (draggingAxisRef.current === "x") setDragging(true);
      }
      if (draggingAxisRef.current !== "x") return;
      const signed = direction === "left" ? -dx : dx; // 正しい向きの動きだけを、プラスにする
      const ratio = Math.max(0, Math.min(MAX_DRAG_RATIO, signed / start.width)) / MAX_DRAG_RATIO;
      setDragPercent(ratio);
    },
    [direction]
  );

  const onPointerUp = useCallback(() => {
    const commit = draggingAxisRef.current === "x" && dragPercent >= THRESHOLD;
    reset();
    if (commit) onCommit?.();
  }, [dragPercent, onCommit, reset]);

  const handlers = useMemo(
    () => (enabled ? { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: reset } : {}),
    [enabled, onPointerDown, onPointerMove, onPointerUp, reset]
  );

  return { dragPercent, dragging, handlers };
}
