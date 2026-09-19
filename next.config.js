/** @type {import('next').NextConfig} */
const nextConfig = {
  // 🔥 以前の形のURL（/bird/メジロ など）で開いても、新しい形のURLに転送する
  async redirects() {
    return [
      { source: "/bird/:slug", destination: "/bird?name=:slug", permanent: false },
      { source: "/loc/:name", destination: "/loc?name=:name", permanent: false },
      { source: "/date/:value", destination: "/date?value=:value", permanent: false },
    ];
  },
};

module.exports = nextConfig;
