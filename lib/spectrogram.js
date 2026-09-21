// 🔥 音声データから簡易的なスペクトログラムを計算する（ブラウザのWeb Audio APIを使用）

// 反復型のCooley-Tukey FFT（サイズは2の累乗である必要がある）
export function fft(re, im) {
  const n = re.length;
  if (n <= 1) return;

  // ビット反転並べ替え
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
        const uRe = re[i + k];
        const uIm = im[i + k];
        const vRe = re[i + k + len / 2] * curRe - im[i + k + len / 2] * curIm;
        const vIm = re[i + k + len / 2] * curIm + im[i + k + len / 2] * curRe;
        re[i + k] = uRe + vRe;
        im[i + k] = uIm + vIm;
        re[i + k + len / 2] = uRe - vRe;
        im[i + k + len / 2] = uIm - vIm;
        const nextRe = curRe * wRe - curIm * wIm;
        const nextIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
        curIm = nextIm;
      }
    }
  }
}

// samples: Float32Array（切り出し済みの音声波形）
// sampleRate・maxFreqHzを指定すると、その上限周波数までだけを計算し、
// 表示範囲いっぱいに引き伸ばす（日本の野鳥で最も高い鳴き声はヤブサメの約10,000Hz程度なので、
// 余裕を見て13,500Hzを上限にする想定）
// 戻り値: { frames, topHz, maxDb, rawFrames } ── framesはframes x binsの振幅(0〜1)の2次元配列、topHzは実際の表示上限周波数。
//   maxDb・rawFrames は、ステレオで、左右に共通の明るさの基準を使うため（normalizeFrames を参照）
export function computeSpectrogram(
  samples,
  { fftSize = 512, hop = 256, bins = 40, sampleRate = null, maxFreqHz = null } = {}
) {
  const numFrames = Math.max(1, Math.floor((samples.length - fftSize) / hop) + 1);
  let maxDb = -Infinity;

  const halfBins = fftSize / 2;
  const freqPerBin = sampleRate ? sampleRate / fftSize : null;
  const maxBinIndex =
    freqPerBin && maxFreqHz ? Math.max(1, Math.min(halfBins, Math.ceil(maxFreqHz / freqPerBin))) : halfBins;
  const topHz = freqPerBin ? maxBinIndex * freqPerBin : null;

  // ハニング窓
  const window = new Float32Array(fftSize);
  for (let i = 0; i < fftSize; i++) {
    window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (fftSize - 1));
  }

  const rawFrames = [];
  const binsPerGroup = Math.max(1, Math.floor(maxBinIndex / bins));
  for (let f = 0; f < numFrames; f++) {
    const start = f * hop;
    const re = new Float32Array(fftSize);
    const im = new Float32Array(fftSize);
    for (let i = 0; i < fftSize; i++) {
      const s = samples[start + i] ?? 0;
      re[i] = s * window[i];
    }
    fft(re, im);

    const grouped = new Float32Array(bins);
    for (let b = 0; b < bins; b++) {
      let sum = 0;
      let count = 0;
      for (let k = b * binsPerGroup; k < (b + 1) * binsPerGroup && k < maxBinIndex; k++) {
        sum += Math.sqrt(re[k] * re[k] + im[k] * im[k]);
        count++;
      }
      const mag = count > 0 ? sum / count : 0;
      const db = 20 * Math.log10(mag + 1e-6);
      grouped[b] = db;
      if (db > maxDb) maxDb = db;
    }
    rawFrames.push(grouped);
  }

  return { frames: normalizeFrames(rawFrames, maxDb), topHz, maxDb, rawFrames };
}

// 0〜1に正規化（maxDb から下の50dBの範囲だけを使い、ノイズフロアを沈める）。
// ステレオでは、左右それぞれの maxDb のうち、大きい方を、両方に使う（左右の音量の差が、明るさの差として残る）
export function normalizeFrames(rawFrames, maxDb) {
  const floor = maxDb - 50;
  return rawFrames.map((grouped) => {
    const normalized = new Float32Array(grouped.length);
    for (let b = 0; b < grouped.length; b++) {
      const clamped = Math.max(floor, Math.min(maxDb, grouped[b]));
      normalized[b] = (clamped - floor) / (maxDb - floor || 1);
    }
    return normalized;
  });
}

// inferno風カラーマップ（黒→紫→オレンジ→黄）
const INFERNO_STOPS = [
  { t: 0.0, rgb: [21, 6, 3] },
  { t: 0.4, rgb: [132, 32, 107] },
  { t: 0.7, rgb: [241, 96, 93] },
  { t: 1.0, rgb: [252, 255, 164] },
];

export function infernoColor(t) {
  const clamped = Math.max(0, Math.min(1, t));
  for (let i = 0; i < INFERNO_STOPS.length - 1; i++) {
    const a = INFERNO_STOPS[i];
    const b = INFERNO_STOPS[i + 1];
    if (clamped >= a.t && clamped <= b.t) {
      const localT = (clamped - a.t) / (b.t - a.t || 1);
      const r = Math.round(a.rgb[0] + (b.rgb[0] - a.rgb[0]) * localT);
      const g = Math.round(a.rgb[1] + (b.rgb[1] - a.rgb[1]) * localT);
      const bl = Math.round(a.rgb[2] + (b.rgb[2] - a.rgb[2]) * localT);
      return `rgb(${r},${g},${bl})`;
    }
  }
  return "rgb(21,6,3)";
}

// 🔥 スペクトログラムを実際にcanvasへ描く。周波数目盛り・再生位置のプレイヘッドも合わせて描画する
export function drawSpectrogram(canvas, frames, { nyquist, playheadT = null, showLabels = true } = {}) {
  const width = canvas.width;
  const height = canvas.height;
  const g = canvas.getContext("2d");
  g.fillStyle = "#150603";
  g.fillRect(0, 0, width, height);
  if (!frames || frames.length === 0) return;

  const bins = frames[0].length;
  const colW = width / frames.length;
  const rowH = height / bins;

  frames.forEach((frame, fi) => {
    for (let b = 0; b < bins; b++) {
      const t = frame[b];
      if (t < 0.05) continue;
      g.fillStyle = infernoColor(t);
      const y = height - (b + 1) * rowH;
      g.fillRect(fi * colW, y, colW + 0.6, rowH + 0.6);
    }
  });

  decorateSpectrogram(g, width, height, nyquist, playheadT, showLabels);
}

// 周波数の目盛り線・目盛りの文字・再生位置（プレイヘッド）を、上に重ねて描く
function decorateSpectrogram(g, width, height, nyquist, playheadT, showLabels) {
  // 周波数の目盛り線（見やすい間隔を自動で選ぶ）
  if (nyquist) {
    const stepHz = nyquist > 12000 ? 4000 : nyquist > 6000 ? 2000 : 1000;
    const gridLineWidth = Math.max(1, Math.round(height / 110));
    g.strokeStyle = "rgba(255,255,255,0.15)";
    g.lineWidth = gridLineWidth;
    if (showLabels) {
      g.fillStyle = "rgba(255,255,255,0.6)";
      g.font = `${Math.max(9, Math.round(height * 0.045))}px sans-serif`;
    }
    for (let hz = stepHz; hz < nyquist; hz += stepHz) {
      const y = height - (hz / nyquist) * height;
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(width, y);
      g.stroke();
      if (showLabels) {
        g.fillText(`${hz / 1000}kHz`, 4, y - 2);
      }
    }
  }

  // 再生位置のプレイヘッド
  if (playheadT != null) {
    const x = Math.max(0, Math.min(width, playheadT * width));
    g.strokeStyle = "#8FC2CB";
    g.lineWidth = Math.max(2, Math.round(height / 70));
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, height);
    g.stroke();
  }
}

// 🔥 ステレオの色分け表示の色（左＝青、右＝オレンジ）。画面の説明・切り替えのボタンにも使う
// 鮮やかな、反対色の組み合わせ：片方にだけ出ている音は、はっきりした青／オレンジに、両方に同じくらい出ている音は、白っぽくなる
export const STEREO_COLORS = { left: [0, 140, 255], right: [255, 140, 0] };

// 🔥 ステレオの表示の切り替え（「左」「右」の2つのスイッチ）。view："LR"＝両方オン／"L"＝左だけ／"R"＝右だけ
//    ・channelIsOn(view, "L")：左のスイッチが、オンか
//    ・toggleChannel(view, "L")：左のスイッチを押したあとの view。全部オフにはならない（少なくとも1つは、オンのまま）
export const channelIsOn = (view, which) => view === "LR" || view === which;
export function toggleChannel(view, which) {
  const on = { L: channelIsOn(view, "L"), R: channelIsOn(view, "R") };
  on[which] = !on[which];
  if (!on.L && !on.R) return view;
  return on.L && on.R ? "LR" : on.L ? "L" : "R";
}

// 🔥 ステレオのスペクトログラム。view：
//    "LR"＝左（青）と右（オレンジ）を、半透明に重ねて表示（光の足し算。両方に出ている音は、白っぽく見える）
//    "L"／"R"＝片方だけを、いつもの配色（inferno）で表示
//    leftFrames／rightFrames：computeSpectrogram の frames（同じ長さ・同じ周波数の行数）
export function drawStereoSpectrogram(
  canvas,
  leftFrames,
  rightFrames,
  { view = "LR", nyquist, playheadT = null, showLabels = true } = {}
) {
  if (view === "L") return drawSpectrogram(canvas, leftFrames, { nyquist, playheadT, showLabels });
  if (view === "R") return drawSpectrogram(canvas, rightFrames, { nyquist, playheadT, showLabels });

  const width = canvas.width;
  const height = canvas.height;
  const g = canvas.getContext("2d");
  g.fillStyle = "#150603";
  g.fillRect(0, 0, width, height);
  if (leftFrames?.length && rightFrames?.length) {
    const img = g.getImageData(0, 0, width, height);
    const d = img.data;
    const frameCount = Math.min(leftFrames.length, rightFrames.length);
    const bins = leftFrames[0].length;
    const [lr, lg, lb] = STEREO_COLORS.left;
    const [rr, rg, rb] = STEREO_COLORS.right;
    for (let y = 0; y < height; y++) {
      const b = Math.min(bins - 1, Math.floor(((height - 1 - y) / height) * bins));
      for (let x = 0; x < width; x++) {
        const fi = Math.min(frameCount - 1, Math.floor((x / width) * frameCount));
        const tl = leftFrames[fi][b];
        const tr = rightFrames[fi][b];
        if (tl < 0.05 && tr < 0.05) continue;
        // 強さに応じた明るさ。弱い音（左右に同じように入っている雑音）は暗く落として、強い音だけが、色付きで浮かび上がるようにする
        const wl = tl < 0.05 ? 0 : Math.min(1, Math.pow(tl, 1.9) * 1.35);
        const wr = tr < 0.05 ? 0 : Math.min(1, Math.pow(tr, 1.9) * 1.35);
        const i = (y * width + x) * 4;
        d[i] = Math.min(255, d[i] + wl * lr + wr * rr);
        d[i + 1] = Math.min(255, d[i + 1] + wl * lg + wr * rg);
        d[i + 2] = Math.min(255, d[i + 2] + wl * lb + wr * rb);
      }
    }
    g.putImageData(img, 0, 0);
  }
  decorateSpectrogram(g, width, height, nyquist, playheadT, showLabels);
}
