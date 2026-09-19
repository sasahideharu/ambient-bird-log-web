import "./globals.css";

export const metadata = {
  title: "Ambient Bird Log",
  description: "身近な野鳥の観察記録",
};

export const viewport = {
  colorScheme: "light",
  viewportFit: "cover",
  themeColor: "#1a1a14",
};

// 🔥 アプリ（iPhone/Android）版だけ、中身が描かれる前の背景を黒にする。
//    明るいベージュが一瞬見えて眩しくなるのを防ぐ（Web版は今までどおり）
const isApp = process.env.BUILD_TARGET === "app";

export default function RootLayout({ children }) {
  return (
    <html lang="ja" className={isApp ? "abl-app" : undefined}>
      <body className="font-body text-ink">{children}</body>
    </html>
  );
}
