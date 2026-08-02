# Ambient Bird Log（Webフロントエンド）

## これは何か

種目録ページの見た目・動きを、実際にNext.jsのプロジェクトとして組み込んだものです。
`npm install` して `npm run dev` すれば、手元のパソコンで動かして確認できます。

## 手元で動かす手順

1. **Node.jsをインストールする**（まだの場合）
   https://nodejs.org/ja からLTS版をダウンロードしてインストールしてください。

2. **このフォルダをターミナルで開く**
   ```
   cd ambient-bird-log-web
   ```

3. **必要なパッケージをインストールする**
   ```
   npm install
   ```
   （このコマンドで、`package.json`に書かれているNext.jsなどのライブラリが自動でダウンロードされます）

4. **開発サーバーを起動する**
   ```
   npm run dev
   ```

5. **ブラウザで確認する**
   `http://localhost:3000` を開くと、種目録ページが表示されます。

## フォルダの中身

- `app/page.js` … 種目録ページの本体（今回確認してもらった内容）
- `app/layout.js` … 全ページ共通の土台
- `app/globals.css` … フォント読み込みなどの全体スタイル
- `tailwind.config.js` … 配色（Ambient Bird Logの色味）の定義
