import { Josefin_Sans } from "next/font/google";
import "./globals.css";
import { Suspense } from "react";
import NavTracker from "../components/NavTracker";

// 🔥 タイトルなどの英字のフォント（Josefin Sans）。以前は Google Fonts から読み込んでいたため、
//    電波が無いと代わりの字体になっていた。ビルドのときに取り込んで、アプリ／サイトの中に同梱する
const josefin = Josefin_Sans({
  subsets: ["latin"],
  weight: ["300", "400", "500"],
  display: "swap",
  variable: "--font-josefin",
});

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
  const htmlClass = [josefin.variable, isApp ? "abl-app" : ""].filter(Boolean).join(" ");
  return (
    <html lang="ja" className={htmlClass}>
      <body className="font-body text-ink">
        {children}
        <Suspense fallback={null}>
          <NavTracker />
        </Suspense>
      </body>
    </html>
  );
}
