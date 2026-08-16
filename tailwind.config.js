/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,jsx}",
    "./components/**/*.{js,jsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Ambient Bird Log の配色トークン
        page: "#FAF8F5",
        header: "#E9E6E1",
        headerText: "#8C877F",
        accent: "#8FC2CB",
        accentText: "#3F6C74",
        cardBorder: "#E9E6E1",
        ink: "#3A3A3A",
        inkMuted: "#9C978F",
      },
      fontFamily: {
        display: [
          "'Hiragino Kaku Gothic ProN'",
          "'Hiragino Sans'",
          "Meiryo",
          "'Yu Gothic'",
          "sans-serif",
        ],
        body: [
          "'Hiragino Kaku Gothic ProN'",
          "'Hiragino Sans'",
          "Meiryo",
          "'Yu Gothic'",
          "sans-serif",
        ],
        hero: ["'Josefin Sans'", "sans-serif"],
      },
    },
  },
  plugins: [],
};
