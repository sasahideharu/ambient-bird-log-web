// 🔥 録音しながら、スペクトログラム（2D）を、少しずつ作って描く部品。
//    push(samples) で、音を渡すと、新しい列ができる。draw(canvas) で、右端が最新になるように、描く。
//    ・縦＝周波数（0〜maxFreqHz・下が低い音）／横＝時間（右が新しい）／色＝音の強さ（inferno）
//    ・明るさは、直近の一番大きい音を基準に、自動で合わせる（ゆっくり戻る）＝小さい音の録音でも、見える

import { fft, infernoColor } from "./spectrogram";

export class LiveSpectrogram {
  constructor({ sampleRate, fftSize = 2048, hop = 1024, bins = 128, maxFreqHz = 13500, seconds = 8, rangeDb = 55 }) {
    this.sampleRate = sampleRate;
    this.fftSize = fftSize;
    this.hop = hop;
    this.bins = bins;
    this.rangeDb = rangeDb;
    this.maxBin = Math.max(1, Math.min(fftSize / 2, Math.ceil(maxFreqHz / (sampleRate / fftSize))));
    this.topHz = this.maxBin * (sampleRate / fftSize);
    this.maxColumns = Math.ceil((seconds * sampleRate) / hop);
    this.columns = []; // 各列：Float32Array(bins)（dB）
    this.window = new Float32Array(fftSize);
    for (let i = 0; i < fftSize; i++) this.window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (fftSize - 1));
    this.pending = new Float32Array(0);
    this.peakDb = -60; // 明るさの基準（直近の、一番大きい音）
    this.re = new Float32Array(fftSize);
    this.im = new Float32Array(fftSize);
  }

  // 音を渡す。戻り値：新しくできた列の数
  push(samples) {
    let buf;
    if (this.pending.length) {
      buf = new Float32Array(this.pending.length + samples.length);
      buf.set(this.pending, 0);
      buf.set(samples, this.pending.length);
    } else {
      buf = samples;
    }
    let made = 0;
    let pos = 0;
    const { fftSize, hop, bins, maxBin, re, im, window: win } = this;
    const perGroup = Math.max(1, Math.floor(maxBin / bins));
    while (pos + fftSize <= buf.length) {
      for (let i = 0; i < fftSize; i++) {
        re[i] = buf[pos + i] * win[i];
        im[i] = 0;
      }
      fft(re, im);
      const col = new Float32Array(bins);
      let colMax = -Infinity;
      for (let b = 0; b < bins; b++) {
        let sum = 0;
        let n = 0;
        for (let k = b * perGroup; k < (b + 1) * perGroup && k < maxBin; k++) {
          sum += Math.sqrt(re[k] * re[k] + im[k] * im[k]);
          n++;
        }
        // 満点（振幅1の正弦波）を 0dB とした強さ。ハニング窓の分（fftSize/4）で割る
        const db = 20 * Math.log10((n ? sum / n : 0) / (fftSize / 4) + 1e-9);
        col[b] = db;
        if (db > colMax) colMax = db;
      }
      this.columns.push(col);
      if (this.columns.length > this.maxColumns) this.columns.shift();
      // 明るさの基準：大きい音には、すぐ追従。小さくなったら、ゆっくり（1列あたり 0.02dB）戻る
      this.peakDb = Math.max(colMax, this.peakDb - 0.02);
      pos += hop;
      made++;
    }
    this.pending = buf.slice(pos);
    return made;
  }

  // canvas に描く（右端が最新）
  draw(canvas) {
    const g = canvas.getContext("2d");
    const w = canvas.width;
    const h = canvas.height;
    g.fillStyle = infernoColor(0);
    g.fillRect(0, 0, w, h);
    const n = this.columns.length;
    if (n === 0) return;
    const colW = w / this.maxColumns;
    const rowH = h / this.bins;
    const top = this.peakDb;
    const floor = top - this.rangeDb;
    const x0 = w - n * colW;
    for (let i = 0; i < n; i++) {
      const col = this.columns[i];
      const x = x0 + i * colW;
      for (let b = 0; b < this.bins; b++) {
        const t = (col[b] - floor) / (top - floor);
        if (t <= 0.02) continue;
        g.fillStyle = infernoColor(t);
        g.fillRect(x, h - (b + 1) * rowH, Math.ceil(colW) + 0.5, Math.ceil(rowH) + 0.5);
      }
    }
    // 周波数の目盛り（4kHz ごと）
    g.fillStyle = "rgba(255,255,255,0.35)";
    g.font = `${Math.round(h / 16)}px sans-serif`;
    for (let hz = 4000; hz < this.topHz; hz += 4000) {
      const y = h - (hz / this.topHz) * h;
      g.fillRect(0, y, w, 1);
      g.fillText(`${hz / 1000}kHz`, 4, y - 3);
    }
  }
}

// 音のかたまりの強さ（満点を 0dB とした、実効値と最大値）
export function levelOf(samples) {
  let sum = 0;
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i];
    sum += v * v;
    const a = Math.abs(v);
    if (a > peak) peak = a;
  }
  const rms = Math.sqrt(sum / (samples.length || 1));
  return { rmsDb: 20 * Math.log10(rms + 1e-9), peakDb: 20 * Math.log10(peak + 1e-9) };
}
