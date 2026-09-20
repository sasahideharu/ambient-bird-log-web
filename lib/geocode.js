// 🔥 場所の名前から、緯度経度を探す（データ登録で、新しい場所を地図で指定するときに使う）。
//    OpenStreetMap の検索サービス（Nominatim）を使う。地図の背景と同じ OpenStreetMap のデータ。
//    ・無料・鍵は不要。ただし、使い方の決まり（1秒に1回まで・入力のたびに検索しない）があるため、
//      検索ボタン（か Enter）を押したときだけ、1回検索する
//    ・検索した文字（場所の名前）が、OpenStreetMap のサーバーに送られる

const ENDPOINT = "https://nominatim.openstreetmap.org/search";

function toPlace(item) {
  const latitude = Number(item.lat);
  const longitude = Number(item.lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

  const parts = String(item.display_name ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const name = (item.name && String(item.name).trim()) || parts[0] || "";
  const address = item.address ?? {};
  const city = address.city || address.town || address.village || address.municipality || address.county || "";

  return {
    name,
    detail: parts.slice(1, 4).join("、"), // 一覧で、同じ名前の場所を見分けるための補足
    latitude,
    longitude,
    // 場所の名前の入力欄が空のときの、候補（既存の「施設名 / 市町村」の形に合わせる）
    suggestedName: city && city !== name ? `${name} / ${city}` : name,
  };
}

export async function searchPlaces(query) {
  const q = query.trim();
  if (!q) return [];
  const params = new URLSearchParams({
    q,
    format: "jsonv2",
    limit: "6",
    addressdetails: "1",
    "accept-language": "ja",
  });
  const res = await fetch(`${ENDPOINT}?${params}`, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`検索サービスがエラーを返しました（${res.status}）`);
  const items = await res.json();
  return items.map(toPlace).filter(Boolean);
}
