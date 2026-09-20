// 🔥 写真を、Supabase の画像変換（Pro プランの機能）で、その場で縮小・軽量化して配信する。
//    元の写真（PNG・最大8MB）は置き直さず、そのまま残す。URL の /object/public/ を
//    /render/image/public/ に変えて、幅と品質を付けるだけで、縮小した WebP が返ってくる。
//    （元画像100枚までは Pro プランに含まれる。同じ写真を複数のサイズに変換しても1枚と数える）
//
//    ⚠ resize=contain が必須。付けないと、標準の cover になり、幅だけ指定したときに
//    「縮小」ではなく「横の中央を切り取り」になる（1408×768 を幅420にすると 420×768 の細長い切り抜きになり、
//    一覧の鳥が拡大されて見える）。contain なら、縦横の比率を保ったまま縮小される（420×229）。

const ORIGINAL_PATH = "/storage/v1/object/public/";
const RENDER_PATH = "/storage/v1/render/image/public/";

export const THUMB_WIDTH = 420; // 一覧のタイル用（1枚 約13KB）
export const LARGE_WIDTH = 1200; // 詳細画面用。オフライン保存もこのサイズ（1枚 約54KB）

export function resizedImageUrl(originalUrl, width, quality) {
  // Supabase の写真ではないURLなど、想定外のものは、そのまま使う
  if (!originalUrl || !originalUrl.includes(ORIGINAL_PATH)) return originalUrl;
  const base = originalUrl.replace(ORIGINAL_PATH, RENDER_PATH);
  const separator = base.includes("?") ? "&" : "?";
  return `${base}${separator}width=${width}&quality=${quality}&resize=contain`;
}

export const thumbImageUrl = (originalUrl) => resizedImageUrl(originalUrl, THUMB_WIDTH, 75);
export const largeImageUrl = (originalUrl) => resizedImageUrl(originalUrl, LARGE_WIDTH, 80);
