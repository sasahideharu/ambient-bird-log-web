import "./globals.css";

export const metadata = {
  title: "Ambient Bird Log",
  description: "身近な野鳥の観察記録",
  colorScheme: "light",
};

export default function RootLayout({ children }) {
  return (
    <html lang="ja">
      <body className="font-body text-ink">{children}</body>
    </html>
  );
}
