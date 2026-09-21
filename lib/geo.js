// 🔥 位置情報（GPS）の取得と、「これまでの場所」から近い場所を探す部品。
//    ・取得できなければ（許可なし・時間切れ・屋内など）、呼び出し側が、デフォルトの場所を使う
//    ・これまでの場所の一覧は、ネットにつながっているときに取ってきて、端末に覚えておく
//      （電波が無いところでも、近くの場所の名前を提案できるように）

import { fetchLocationChoices } from "./importData";

const PLACES_KEY = "abl.places.cache";

// 現在地を取る。戻り値：{ latitude, longitude, accuracyM }。取れなければ、例外（message＝理由）
export function getPosition({ timeoutMs = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("この端末では、位置情報を使えません"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracyM: pos.coords.accuracy }),
      (err) => {
        const reason = { 1: "位置情報が許可されていません", 2: "位置情報を取得できませんでした", 3: "位置情報の取得が、時間切れになりました" }[err.code];
        reject(new Error(reason ?? err.message ?? "位置情報を取得できませんでした"));
      },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 30000 }
    );
  });
}

// 2点の距離（メートル）
export function distanceM(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// これまでの場所の一覧 [{ name, latitude, longitude }]。ネットから取れたら、端末に覚える。取れなければ、覚えているもの
export async function loadPlaces() {
  try {
    const places = await fetchLocationChoices();
    try {
      window.localStorage.setItem(PLACES_KEY, JSON.stringify(places));
    } catch {
      // 覚えられない環境
    }
    return places;
  } catch {
    try {
      return JSON.parse(window.localStorage.getItem(PLACES_KEY) ?? "[]");
    } catch {
      return [];
    }
  }
}

// 位置に、いちばん近い場所（maxM メートル以内）。無ければ null。戻り値：{ place, distanceM }
export function nearestPlace(pos, places, maxM = 300) {
  let best = null;
  for (const p of places ?? []) {
    const d = distanceM(pos.latitude, pos.longitude, p.latitude, p.longitude);
    if (d <= maxM && (!best || d < best.distanceM)) best = { place: p, distanceM: d };
  }
  return best;
}
