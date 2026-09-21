// 🔥 録音した端末（機材）の情報。「いつ・誰が・何の機材で」の「何の機材で」に使う。
//    ブラウザの情報（UserAgent）から、種類・OS・機種を取り出す。
//    ・Android：機種名が入っている（例 KYG02）
//    ・iPhone：機種名は、UserAgent に入っていない（「iPhone」まで）。OS のバージョンは分かる

import { Capacitor } from "@capacitor/core";

export function getDeviceInfo() {
  const ua = navigator.userAgent;
  const platform = Capacitor.getPlatform(); // "ios" | "android" | "web"
  let os = platform;
  let osVersion = null;
  let model = null;
  let manufacturer = null;

  if (/Android/.test(ua)) {
    os = "Android";
    const m = /Android ([\d.]+);\s*([^;)]+?)(?:\s+Build\/|\))/.exec(ua);
    osVersion = m?.[1] ?? null;
    model = m?.[2]?.trim() ?? null;
  } else if (/iPhone|iPad|iPod/.test(ua)) {
    os = "iOS";
    manufacturer = "Apple";
    model = /iPad/.test(ua) ? "iPad" : /iPod/.test(ua) ? "iPod" : "iPhone";
    const v = /OS (\d+)[_.](\d+)(?:[_.](\d+))?/.exec(ua);
    osVersion = v ? `${v[1]}.${v[2]}${v[3] ? `.${v[3]}` : ""}` : null;
  } else {
    os = navigator.platform || "web";
  }

  return {
    platform, // アプリの種類（ios／android）。ブラウザは web
    native: Capacitor.isNativePlatform(),
    os,
    osVersion,
    model,
    manufacturer,
    userAgent: ua,
    screen: `${screen.width}x${screen.height}@${window.devicePixelRatio}`,
    cores: navigator.hardwareConcurrency ?? null,
    memoryGb: navigator.deviceMemory ?? null,
  };
}

// 画面に出す短い名前（例 "iPhone（iOS 18.7）"・"KYG02（Android 15）"）
export function deviceLabel(d) {
  if (!d) return "不明";
  const name = d.model || d.os || d.platform;
  return d.osVersion ? `${name}（${d.os} ${d.osVersion}）` : name;
}
