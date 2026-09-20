"use client";

import { useState, useEffect } from "react";
import { supabase } from "../lib/supabaseClient";
import { useLoginState } from "../lib/useLoginState";
import ImportDataPanel from "./ImportDataPanel";
import ImportImagePanel from "./ImportImagePanel";
import PerchBackfillPanel from "./PerchBackfillPanel";

// 🔥 データ登録の中身（管理者だけ）。管理画面の「データ登録」タブと、/import の両方で使う。
//    書き込みは、データベース側で「管理者名簿にいる人だけ」に制限している。
//    この画面でも、名簿にいるかを確認して、いない人には出さない
export default function ImportSection() {
  const login = useLoginState();
  const [isAdmin, setIsAdmin] = useState(null); // null＝確認中
  const [mode, setMode] = useState("data");

  useEffect(() => {
    if (!login.ready) return;
    if (!login.loggedIn) {
      setIsAdmin(false);
      return;
    }
    let alive = true;
    supabase
      .from("app_admins")
      .select("user_id")
      .maybeSingle()
      .then(({ data, error }) => {
        if (alive) setIsAdmin(!error && !!data);
      });
    return () => {
      alive = false;
    };
  }, [login.ready, login.loggedIn]);

  const pillClass = (active) =>
    `flex-1 rounded-full py-2 text-xs font-bold border-2 transition-colors ${
      active ? "bg-white text-ink border-accentText" : "bg-transparent text-inkMuted border-cardBorder"
    }`;

  return (
    <div className="pt-4">
      <p className="px-5 mb-3 text-[11px] text-inkMuted font-bold leading-relaxed">
        BirdNET の結果（CSV）と録音（MP3）、鳥の写真を登録します。消す機能はありません。
      </p>

      {(isAdmin === null || !login.ready) && (
        <p className="text-center text-xs text-inkMuted py-10">確認中...</p>
      )}
      {login.ready && isAdmin === false && (
        <p className="text-center text-xs text-inkMuted py-10 px-6">
          この画面は、ログイン中の管理者だけが使えます。
        </p>
      )}

      {isAdmin && (
        <>
          <div className="flex gap-2 px-4 mb-3">
            <button onClick={() => setMode("data")} className={pillClass(mode === "data")}>
              🎵 解析データ＆音声
            </button>
            <button onClick={() => setMode("image")} className={pillClass(mode === "image")}>
              📷 鳥の写真
            </button>
            <button onClick={() => setMode("perch")} className={pillClass(mode === "perch")}>
              🔍 Perch
            </button>
          </div>
          {mode === "data" ? <ImportDataPanel /> : mode === "image" ? <ImportImagePanel /> : <PerchBackfillPanel />}
        </>
      )}
    </div>
  );
}
