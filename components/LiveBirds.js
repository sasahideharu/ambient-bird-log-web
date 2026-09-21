"use client";

import { PERCH_STRONG_LOGIT } from "../lib/liveSpecies";

const mmss = (sec) => {
  const s = Math.max(0, Math.floor(sec));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

const STATUS_TEXT = {
  idle: "解析の準備中…",
  working: "解析中…（サーバーを起こしています）",
  ok: "解析中",
  slow: "解析中（返事が遅めです）",
  offline: "電波なし：録音だけ（あとで解析）",
  error: "解析できません（録音は続いています）",
  auth: "ログインが切れました（録音は続いています）",
  off: "リアルタイム解析：切（録音だけ）",
  finished: "この録音の、リアルタイム解析の結果",
};

function Row({ e, model }) {
  const m = e[model];
  const strong = model === "pc" && m.logit >= PERCH_STRONG_LOGIT;
  const score = model === "bn" ? `${Math.round(m.conf * 100)}%` : m.logit.toFixed(1);
  return (
    <li
      className={`rounded-lg px-1.5 py-1 leading-tight ${e.agreeNow ? "bg-[#DDF3E4] ring-2 ring-[#3E9B5F]" : e.agreed ? "bg-[#EEF7F1]" : e.recent ? "bg-[#F3F0EA]" : ""}`}
    >
      <div className={`break-words text-[11px] ${e.agreed ? "font-bold" : ""} ${e.recent ? "text-ink" : "text-inkMuted"}`}>
        {e.agreed && <span className="text-[#2F8050]">✓</span>}
        {e.common ?? e.sci}
      </div>
      <div className="flex items-baseline justify-between gap-1 text-[9px] tabular-nums text-inkMuted">
        <span className={`text-[10px] ${strong || model === "bn" ? "font-bold text-ink" : ""}`}>{score}</span>
        <span>
          {e.recent ? "いま" : mmss(m.lastSec)}・{m.count}回
        </span>
      </div>
    </li>
  );
}

function Column({ title, rows, model, empty }) {
  return (
    <div className="min-w-0">
      <div className="mb-1 text-center text-[11px] font-bold text-[#3F6C74]">{title}</div>
      <ul className="max-h-52 space-y-1 overflow-y-auto p-0.5">
        {rows.length === 0 ? <li className="px-1 py-2 text-center text-[10px] text-inkMuted">{empty}</li> : rows.map((e) => <Row key={e.sci} e={e} model={model} />)}
      </ul>
    </div>
  );
}

// 🔥 録音画面の、鳥の一覧。左＝BirdNET／右＝Perch。両方が、同じ鳥を挙げたら、緑で強調する（✓）
//    list：listLive() の結果／state：エンジンの状態（status・message・latencySec など）／enabled：リアルタイム解析が入か
export default function LiveBirds({ list, state, enabled, finished = false }) {
  const status = finished ? "finished" : !enabled ? "off" : (state?.status ?? "idle");
  const warn = !finished && (status === "offline" || status === "error" || status === "auth");
  return (
    <div className="mt-3">
      <div className={`mb-1.5 flex items-center justify-between text-[10px] ${warn ? "text-[#C2860A]" : "text-inkMuted"}`}>
        <span className="font-bold">{STATUS_TEXT[status] ?? ""}</span>
        {state?.latencySec != null && status !== "off" && !finished && <span className="tabular-nums">{state.latencySec}秒</span>}
      </div>
      {state?.message && enabled && !finished && <p className="mb-1.5 text-[10px] leading-relaxed text-[#C2860A]">{state.message}</p>}
      {list.agreed.length > 0 && (
        <div className="mb-2 rounded-lg bg-[#DDF3E4] px-2 py-1.5 text-[11px] leading-relaxed text-[#1F5E3A]">
          <span className="font-bold">✓ 両方が一致：</span>
          {list.agreed.map((e) => e.common ?? e.sci).join("・")}
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <Column title="BirdNET" rows={list.bn} model="bn" empty="まだ、ありません" />
        <Column title="Perch" rows={list.pc} model="pc" empty="まだ、ありません" />
      </div>
      <p className="mt-1.5 text-[9px] leading-relaxed text-inkMuted">
        BirdNET：3秒ごとの信頼度（25%以上）／Perch：5秒ごとの点数（6以上・8以上は強い）。参考の表示で、録音を登録するときに、あらためて解析します。
      </p>
    </div>
  );
}
