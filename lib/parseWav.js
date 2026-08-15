// wav_filename は "260801_057_0812.mp3" のような形式が正式だが、
// 古いレコードには "260801_057.mp3" のように収録時刻(_hhmm)が付いていないものもある
// 260801 = 収録日(YYMMDD)、057 = 連番、0812 = 収録時刻(HHMM・省略されることがある)
const FULL_PATTERN = /^(\d{2})(\d{2})(\d{2})_\d+_(\d{2})(\d{2})\.mp3$/;
const DATE_ONLY_PATTERN = /^(\d{2})(\d{2})(\d{2})_/;

export function parseWavFilename(wavFilename) {
  if (!wavFilename) return null;

  const fullMatch = FULL_PATTERN.exec(wavFilename);
  if (fullMatch) {
    const [, yy, mm, dd, hh, min] = fullMatch;
    return {
      date: `${mm}/${dd}`,
      time: `${hh}:${min}`,
      isoDate: `20${yy}-${mm}-${dd}`,
    };
  }

  // 🔥 _hhmmが付いていないファイル名でも、頭6桁(YYMMDD)から日付だけは取り出す
  const dateOnlyMatch = DATE_ONLY_PATTERN.exec(wavFilename);
  if (dateOnlyMatch) {
    const [, yy, mm, dd] = dateOnlyMatch;
    return {
      date: `${mm}/${dd}`,
      time: null,
      isoDate: `20${yy}-${mm}-${dd}`,
    };
  }

  return null;
}
