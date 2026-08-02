// wav_filename は "260801_057_0812.mp3" のような形式
// 260801 = 収録日(YYMMDD)、057 = 連番、0812 = 収録時刻(HHMM)
const FILENAME_PATTERN = /^(\d{2})(\d{2})(\d{2})_\d+_(\d{2})(\d{2})\.mp3$/;

export function parseWavFilename(wavFilename) {
  if (!wavFilename) return null;
  const match = FILENAME_PATTERN.exec(wavFilename);
  if (!match) return null;

  const [, yy, mm, dd, hh, min] = match;
  return {
    date: `${mm}/${dd}`,
    time: `${hh}:${min}`,
  };
}
