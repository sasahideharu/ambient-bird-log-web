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
        page: "#F4F2EC",
        header: "#7C8C74",
        headerText: "#EDEFE7",
        accent: "#B4CF9E",
        accentText: "#6F8F5E",
        cardBorder: "#E5E0D2",
        ink: "#3A3A3A",
        inkMuted: "#8A8A78",
      },
      fontFamily: {
        display: ["'Yusei Magic'", "sans-serif"],
        body: ["'Zen Maru Gothic'", "sans-serif"],
      },
    },
  },
  plugins: [],
};
