// 🔥 仮データ（本実装では Supabase の bird_master / detections テーブルから取得する）

export const SPECIES = [
  {
    slug: "mejiro",
    name: "メジロ",
    scientificName: "Zosterops japonicus",
    family: "スズメ目メジロ科",
    confidence: 82,
    color: "#C7D3C9",
    emoji: "🐦",
    locationCount: 2,
    records: [
      { id: "014", confidence: 82, date: "08/01", location: "庭", time: "08:03" },
      { id: "009", confidence: 76, date: "07/27", location: "裏山", time: "06:58" },
      { id: "003", confidence: 91, date: "07/26", location: "庭", time: "06:20" },
    ],
  },
  {
    slug: "suzume",
    name: "スズメ",
    scientificName: "Passer montanus",
    family: "スズメ目スズメ科",
    confidence: 68,
    color: "#D9CFC0",
    emoji: "🐤",
    locationCount: 1,
    records: [
      { id: "011", confidence: 68, date: "08/01", location: "庭", time: "07:41" },
      { id: "005", confidence: 60, date: "07/26", location: "庭", time: "06:55" },
    ],
  },
  {
    slug: "hiyodori",
    name: "ヒヨドリ",
    scientificName: "Hypsipetes amaurotis",
    family: "スズメ目ヒヨドリ科",
    confidence: 91,
    color: "#C9C7D1",
    emoji: "🐧",
    locationCount: 2,
    records: [
      { id: "012", confidence: 91, date: "07/27", location: "裏山", time: "06:58" },
      { id: "007", confidence: 79, date: "07/26", location: "庭", time: "17:12" },
    ],
  },
  {
    slug: "shijukara",
    name: "シジュウカラ",
    scientificName: "Parus minor",
    family: "スズメ目シジュウカラ科",
    confidence: 74,
    color: "#BFCDB8",
    emoji: "🦜",
    locationCount: 1,
    records: [
      { id: "008", confidence: 74, date: "07/27", location: "庭", time: "09:10" },
    ],
  },
  {
    slug: "uguisu",
    name: "ウグイス",
    scientificName: "Horornis diphone",
    family: "スズメ目ウグイス科",
    confidence: 55,
    color: "#D9CBA0",
    emoji: "🐥",
    locationCount: 1,
    records: [
      { id: "002", confidence: 55, date: "07/26", location: "裏山", time: "05:40" },
    ],
  },
  {
    slug: "kawasemi",
    name: "カワセミ",
    scientificName: "Alcedo atthis",
    family: "ブッポウソウ目カワセミ科",
    confidence: 88,
    color: "#B7CBCE",
    emoji: "🦆",
    locationCount: 1,
    records: [
      { id: "001", confidence: 88, date: "07/25", location: "裏山", time: "07:02" },
    ],
  },
];

export const LOCATIONS = [
  { name: "庭", emoji: "🏡", color: "#C7D3C9", speciesCount: 8, recordCount: 24, lastSeen: "08/01" },
  { name: "裏山", emoji: "⛰️", color: "#BFCDB8", speciesCount: 5, recordCount: 12, lastSeen: "07/27" },
];
