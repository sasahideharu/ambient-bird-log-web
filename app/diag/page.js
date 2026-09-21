"use client";

import RecordingDiag from "../../components/RecordingDiag";
import { useSystemBars } from "../../lib/useSystemBars";

// 🔥 録音の下見（診断）画面。開発用（ログイン中の人だけ）。マイク・位置情報・画面を消したときの挙動を、この端末で確かめる
export default function DiagPage() {
  useSystemBars("light"); // 明るい背景：バーの文字は黒
  return <RecordingDiag />;
}
