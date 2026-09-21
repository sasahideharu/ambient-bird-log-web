"use client";

import RecordingsList from "../../components/RecordingsList";
import { useSystemBars } from "../../lib/useSystemBars";

// 🔥 録音の一覧（この端末に保存してある録音）
export default function RecordingsPage() {
  useSystemBars("light"); // 明るい背景：バーの文字は黒
  return <RecordingsList />;
}
