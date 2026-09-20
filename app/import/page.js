"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { supabase } from "../../lib/supabaseClient";
import { useSystemBars } from "../../lib/useSystemBars";
import { useLoginState } from "../../lib/useLoginState";
import ImportDataPanel from "../../components/ImportDataPanel";
import ImportImagePanel from "../../components/ImportImagePanel";

// 🔥 データ登録（管理者だけ）。Streamlit の「データ登録」「画像管理」を、新しいアプリに移したもの。
//    書き込みは、データベース側で「管理者名簿にいる人だけ」に制限している。
//    この画面でも、名簿にいるかを確認して、いない人には出さない
export default function ImportPage() {
  useSystemBars("light"); // 明るい背景：バーの文字は黒
  const login = useLoginState();
  const [isAdmin, setIsAdmin] = useState(null); // null＝確認中
  const [tab, setTab] = useState("data");

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

  const tabClass = (active) =>
    `pb-2 mr-6 text-sm font-bold border-b-[3px] transition-colors ${
      active ? "text-ink border-accentText" : "text-inkMuted border-transparent"
    }`;

  return (
    <div className="abl-page-safe min-h-screen w-full flex justify-center bg-page px-6">
      <div className="w-full max-w-sm bg-page rounded-[28px] border-[6px] border-white shadow-xl overflow-hidden">
        <Link href="/admin" className="block px-4 pt-4 text-xs font-bold text-[#3F6C74]">
          ‹ 管理画面に戻る
        </Link>

        <div className="mx-4 mt-2.5 mb-3 bg-white border-[3px] border-cardBorder rounded-2xl p-4">
          <div className="font-display text-xl">データ登録</div>
          <div className="text-[11px] text-inkMuted font-bold mt-0.5 leading-relaxed">
            BirdNET の結果（CSV）と録音（MP3）、鳥の写真を登録します。消す機能はありません。
          </div>
        </div>

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
            <div className="flex px-5 border-b border-cardBorder mb-3">
              <button onClick={() => setTab("data")} className={tabClass(tab === "data")}>
                🎵 解析データ＆音声
              </button>
              <button onClick={() => setTab("image")} className={tabClass(tab === "image")}>
                📷 鳥の写真
              </button>
            </div>
            {tab === "data" ? <ImportDataPanel /> : <ImportImagePanel />}
          </>
        )}
      </div>
    </div>
  );
}
