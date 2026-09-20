"use client";

import { useEffect } from "react";
import { Capacitor, SystemBars, SystemBarsStyle } from "@capacitor/core";

// 🔥 アプリ（iPhone/Android）で、上のステータスバー（時刻・電池）と下の操作ボタンの文字色を、
//    そのページの背景に合わせる。暗い背景（ホーム）＝白い文字、明るい背景（管理画面・鳥・地点・日）＝黒い文字。
//    合わせないと、明るいページで白い文字になり、ほとんど読めない。Web版では何もしない
export function useSystemBars(background) {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    SystemBars.setStyle({
      style: background === "dark" ? SystemBarsStyle.Dark : SystemBarsStyle.Light,
    }).catch(() => {});
  }, [background]);
}
