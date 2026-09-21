"use client";

import RecordScreen from "../../components/RecordScreen";
import { useSystemBars } from "../../lib/useSystemBars";

// 🔥 録音画面（ログイン中の管理者だけ）。録音ボタン・スペクトログラムのリアルタイム表示・端末への保存
export default function RecordPage() {
  useSystemBars("light"); // 明るい背景：バーの文字は黒
  return <RecordScreen />;
}
