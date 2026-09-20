// 🔥 音声の「フォーカス」加工（編集機能）。ブラウザの中だけで動く（サーバー不要）。
//
//    選んだ範囲（時間 t0〜t1・周波数 fLo〜fHi）だけを取り出し、範囲の外の周波数の音を下げる。
//    ・時間：選んだ範囲だけを切り出す（外は除く）
//    ・周波数：範囲の中は、そのまま。外は、範囲から遠くなるほど、大きく下げる（近い周波数は、うっすら聞こえる）
//
//    「下げ方」の基準（mode）
//      ratio（標準）：取り除く範囲（範囲より下＝0〜fLo、範囲より上＝fHi〜表示の上限）の広さに対する、割合で決める。
//                     範囲との近さ r（0＝範囲の端、1＝その領域の一番遠く）から、下げ幅 ＝ strengthDb × y(r)。
//                     低くて狭い範囲でも、高い範囲でも、「見たまま」の割合で効く。
//                     steep（消す強さ）：y(r) ＝ (1−e^(−steep·r)) / (1−e^(−steep))。大きいほど、範囲のすぐ外で一気に下がり、
//                     そのあとは底で平らになる（崖のような形）。steep が 0 以下のときだけ、従来の y(r) ＝ r^curve
//      octave        ：範囲の端から1オクターブ離れるごとに octaveDb ずつ下げる（最大 strengthDb まで）。
//    curve：（steep が無いときだけ）1より大きいほど、近くの音が長く残る。1より小さいほど、すぐ下がる。
//    floorDb：範囲の外を「少し残す」ときの下限（dB。例 -40）。下げ幅が、これより深くならない。null＝残さない（完全に消す）
//
//    周波数ごとの下げ幅は、短時間フーリエ変換（STFT）で、周波数ごとに掛けて、元の波形に戻す（重ね合わせ）。

export const DEFAULT_FOCUS = {
  mode: "ratio", // "ratio" | "octave"
  strengthDb: 120, // 一番遠くで下げる量（dB）の上限
  steep: 32, // 消す強さ（ratio のとき）。大きいほど、範囲のすぐ外で一気に下がる（0＝従来の r^curve）
  curve: 1.5, // 近くの残り方（steep が 0 のときだけ使う）
  octaveDb: 96, // 1オクターブごとに下げる量（octave のとき）
  floorDb: null, // 範囲の外を少し残すときの下限（dB）。null＝残さない
};

// 画面の「消す強さ」スライダー（0〜100）と、steep の変換
export const steepFromPercent = (pct) => 1 + 0.39 * pct;
export const percentFromSteep = (steep) => Math.round(Math.max(0, Math.min(100, (steep - 1) / 0.39)));

const FFT_SIZE = 2048;
const HOP = FFT_SIZE / 4;

// ---------- FFT（2の累乗の長さ）----------

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wRe = Math.cos(ang);
    const wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curRe = 1;
      let curIm = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = i + k + len / 2;
        const vRe = re[b] * curRe - im[b] * curIm;
        const vIm = re[b] * curIm + im[b] * curRe;
        re[b] = re[a] - vRe;
        im[b] = im[a] - vIm;
        re[a] += vRe;
        im[a] += vIm;
        const nRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nRe;
      }
    }
  }
}

// 逆変換：実部と虚部を入れ替えて、順変換をして、入れ替え直す（÷n は呼び出し側）
function ifft(re, im) {
  fft(im, re);
}

// ---------- 周波数ごとの下げ幅 ----------

// 周波数 f（Hz）の、下げ幅（dB。0以下）
//   fLo〜fHi：残す範囲（Hz）／topHz：スペクトログラムの表示の上限（これより上は、全て一番遠く扱い）
export function focusGainDb(f, { fLo, fHi, topHz }, settings = DEFAULT_FOCUS) {
  const { mode, strengthDb, curve, octaveDb, floorDb, steep } = { ...DEFAULT_FOCUS, ...settings };
  if (f >= fLo && f <= fHi) return 0;

  let db;
  if (mode === "octave") {
    const octaves = f < fLo ? (f <= 0 ? Infinity : Math.log2(fLo / f)) : Math.log2(f / fHi);
    db = -Math.min(strengthDb, octaveDb * octaves);
  } else {
    // ratio：取り除く領域の広さに対する、近さの割合
    let r;
    if (f < fLo) {
      r = fLo > 0 ? (fLo - f) / fLo : 1;
    } else {
      r = topHz > fHi ? (f - fHi) / (topHz - fHi) : 1;
    }
    r = Math.max(0, Math.min(1, r));
    const y = steep > 0 ? (1 - Math.exp(-steep * r)) / (1 - Math.exp(-steep)) : Math.pow(r, curve);
    db = -strengthDb * y;
  }
  // 範囲の外を「少し残す」設定：これより深くは、下げない
  return floorDb == null ? db : Math.max(db, floorDb);
}

// STFT の各ビン（0〜FFT_SIZE/2）に掛ける、振幅の倍率
function buildGains(sampleRate, band, settings) {
  const bins = FFT_SIZE / 2 + 1;
  const g = new Float32Array(bins);
  for (let k = 0; k < bins; k++) {
    const f = (k * sampleRate) / FFT_SIZE;
    g[k] = Math.pow(10, focusGainDb(f, band, settings) / 20);
  }
  return g;
}

// ---------- 加工 ----------

// 1本の波形（切り出し済み）に、周波数ごとの倍率を掛ける（STFT・重ね合わせ）。長さは、入力と同じ
function filterSegment(x, gains, window) {
  const len = x.length;
  // 端の処理のため、前後に FFT_SIZE ぶんの無音を足して処理する
  const padded = new Float32Array(len + 2 * FFT_SIZE);
  padded.set(x, FFT_SIZE);
  const out = new Float32Array(padded.length);
  const norm = new Float32Array(padded.length);

  const re = new Float32Array(FFT_SIZE);
  const im = new Float32Array(FFT_SIZE);
  for (let pos = 0; pos + FFT_SIZE <= padded.length; pos += HOP) {
    for (let i = 0; i < FFT_SIZE; i++) {
      re[i] = padded[pos + i] * window[i];
      im[i] = 0;
    }
    fft(re, im);
    // 実数の波形なので、負の周波数側（N-k）にも、同じ倍率を掛ける
    for (let k = 0; k <= FFT_SIZE / 2; k++) {
      re[k] *= gains[k];
      im[k] *= gains[k];
      if (k > 0 && k < FFT_SIZE / 2) {
        re[FFT_SIZE - k] *= gains[k];
        im[FFT_SIZE - k] *= gains[k];
      }
    }
    ifft(re, im);
    for (let i = 0; i < FFT_SIZE; i++) {
      out[pos + i] += (re[i] / FFT_SIZE) * window[i];
      norm[pos + i] += window[i] * window[i];
    }
  }

  const y = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const n = norm[FFT_SIZE + i];
    y[i] = n > 1e-6 ? out[FFT_SIZE + i] / n : 0;
  }
  return y;
}

// channels：元の波形の配列（Float32Array の配列。モノラル＝1本、ステレオ＝2本）／sampleRate：サンプリング周波数
// range：{ t0, t1（秒）, fLo, fHi, topHz（Hz） }／settings：DEFAULT_FOCUS の形
// options：{ normalize（音量を揃える・標準 true）, fadeMs（切り出しの端のなだらかさ・標準 10）, targetPeak（標準 0.89 ≒ -1dBFS）}
// 戻り値：加工後の波形の配列（チャンネルごとの Float32Array・切り出した長さ）
//   ・全てのチャンネルに、同じ倍率（周波数ごと）を掛ける＝左右の位置関係（ステレオの広がり）は、そのまま
//   ・音量を揃えるときは、全チャンネルの最大値で決めた、共通の倍率を掛ける＝左右の音量の差も、そのまま
export function renderFocusedMulti(channels, sampleRate, range, settings = DEFAULT_FOCUS, options = {}) {
  const { normalize = true, fadeMs = 10, targetPeak = 0.89 } = options;
  const total = channels[0]?.length ?? 0;
  const i0 = Math.max(0, Math.floor(range.t0 * sampleRate));
  const i1 = Math.min(total, Math.ceil(range.t1 * sampleRate));
  const len = i1 - i0;
  if (len <= 0) return channels.map(() => new Float32Array(0));

  const gains = buildGains(sampleRate, range, settings);
  const window = new Float32Array(FFT_SIZE);
  for (let i = 0; i < FFT_SIZE; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / FFT_SIZE);

  const outs = channels.map((ch) => filterSegment(ch.subarray(i0, i1), gains, window));

  // 切り出しの端で、ぷつっと鳴らないよう、短くなだらかにする
  const fade = Math.min(Math.floor((fadeMs / 1000) * sampleRate), Math.floor(len / 2));
  for (const y of outs) {
    for (let i = 0; i < fade; i++) {
      const w = i / fade;
      y[i] *= w;
      y[len - 1 - i] *= w;
    }
  }

  if (normalize) {
    let peak = 0;
    for (const y of outs) for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(y[i]));
    if (peak > 1e-6) {
      // ほぼ無音のものを、無理に大きくしすぎない（最大 +50dB）
      const gain = Math.min(targetPeak / peak, Math.pow(10, 50 / 20));
      for (const y of outs) for (let i = 0; i < len; i++) y[i] *= gain;
    }
  }
  return outs;
}

// モノラル1本の波形を加工する（renderFocusedMulti の、1チャンネル版）
export function renderFocused(samples, sampleRate, range, settings = DEFAULT_FOCUS, options = {}) {
  return renderFocusedMulti([samples], sampleRate, range, settings, options)[0];
}

// ---------- 周波数の範囲の提案 ----------

// スペクトログラム（frames：時間×周波数の強さ 0〜1、topHz：一番上の周波数）の、時間の範囲の中で、
// 「背景の雑音より強く出ている」周波数の付近を、範囲として提案する。
//   ・背景＝ファイル全体での、周波数ごとの中央値（風や川の音など、ずっと鳴っている音）
//   ・その範囲で、背景を超えた分が一番大きい周波数を中心に、その半分以上が続く範囲（最低 1kHz の幅）
//   ・700Hz より下は、風などの雑音が多いため、探さない
const SUGGEST_FLOOR_HZ = 700;

export function suggestBand(frames, topHz, duration, t0, t1) {
  if (!frames || frames.length === 0) return { fLo: 0, fHi: topHz };
  const bins = frames[0].length;
  const binHz = topHz / bins;

  const bg = new Float32Array(bins);
  const column = new Float32Array(frames.length);
  for (let b = 0; b < bins; b++) {
    for (let f = 0; f < frames.length; f++) column[f] = frames[f][b];
    bg[b] = column.slice().sort()[Math.floor(frames.length / 2)];
  }

  const f0 = Math.max(0, Math.floor((t0 / duration) * frames.length));
  const f1 = Math.min(frames.length, Math.max(f0 + 1, Math.ceil((t1 / duration) * frames.length)));
  const excess = new Float32Array(bins);
  for (let f = f0; f < f1; f++) {
    for (let b = 0; b < bins; b++) excess[b] += Math.max(0, frames[f][b] - bg[b]);
  }
  const minBin = Math.min(bins - 1, Math.floor(SUGGEST_FLOOR_HZ / binHz));
  let peak = 0;
  let peakBin = -1;
  for (let b = minBin; b < bins; b++) {
    excess[b] /= f1 - f0;
    if (excess[b] > peak) {
      peak = excess[b];
      peakBin = b;
    }
  }
  if (peakBin < 0 || peak < 1e-4) return { fLo: Math.round(SUGGEST_FLOOR_HZ), fHi: Math.round(topHz) }; // 手がかりが無いときは、広く

  const threshold = peak * 0.5;
  let lo = peakBin;
  let hi = peakBin;
  while (lo > minBin && excess[lo - 1] >= threshold) lo--;
  while (hi < bins - 1 && excess[hi + 1] >= threshold) hi++;
  let fLo = lo * binHz;
  let fHi = (hi + 1) * binHz;
  if (fHi - fLo < 1000) {
    const mid = (fLo + fHi) / 2;
    fHi = Math.min(topHz, mid + 500);
    fLo = Math.max(0, fHi - 1000);
    fHi = Math.min(topHz, fLo + 1000);
  }
  return { fLo: Math.round(fLo), fHi: Math.round(fHi) };
}
