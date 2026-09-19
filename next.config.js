/** @type {import('next').NextConfig} */

// 🔥 BUILD_TARGET=app のときは、iPhone/Androidアプリに入れるための「静的書き出し」（out フォルダ）を行う。
//    静的書き出しでは転送設定（redirects）が使えないため、Web版（Vercel）のビルドだけに付ける。
const isApp = process.env.BUILD_TARGET === "app";

const nextConfig = isApp
  ? {
      output: "export",
      distDir: "out", // 書き出し先（Web版の .next と混ざらないように分ける）。capacitor.config.json の webDir と同じ
      // 静的書き出しでは next/image の画像最適化サーバーが無いため、最適化を切る（切らないと背景写真が表示されない）
      images: { unoptimized: true },
    }
  : {
      // 以前の形のURL（/bird/メジロ など）で開いても、新しい形のURLに転送する
      async redirects() {
        return [
          { source: "/bird/:slug", destination: "/bird?name=:slug", permanent: false },
          { source: "/loc/:name", destination: "/loc?name=:name", permanent: false },
          { source: "/date/:value", destination: "/date?value=:value", permanent: false },
        ];
      },
    };

module.exports = nextConfig;
