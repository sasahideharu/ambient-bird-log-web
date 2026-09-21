// 🔥 3D スペクトログラムの描画（three.js）。画面（components/Spectrogram3D.js）から使う。
//    縦＝周波数、横＝左右（音が大きいほど、中心から外へ幅広く：左の音は左へ、右の音は右へ）、奥＝時間。
//    ・描き方：線（初期）＝時間ごとに、その瞬間の左右の音の輪郭を1本の線にして、奥へ並べる／面＝左右の面（時間×周波数の格子）を、音の大きさで、横へふくらませる／面＋線。音の強さで色をつける
//    ・再生位置：再生中だけ、白い枠と、その瞬間の左右の音の輪郭（白い線）が、奥行き（時間）に沿って進む（再生していないときは、出さない）
//    ・再生中は、視点が「横」から「ななめ」へ、ゆっくり変わる（聞き終わりは「ななめ」）。手で回すと止まる
//    ・グリッド線：白い線。グラフより手前の壁は描かない（視点から見て奥側の壁と、床だけ）
//    データ：{ left, right（Float32Array・時間×周波数・0〜1）, frames, bins, duration（秒）, topHz, channels }

import * as THREE from "three";

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const H = 1.6; // 周波数（縦）の高さ
// 再生位置の見せ方：白い枠（位置）と、音のある部分の「輪郭線」（音が出ているところ）＋ごく薄い帯
//   輪郭線は、ボカさない：透けさせず（濃さは 0 か 1）、太さは、画面の点（ピクセル）の整数ぶんだけ、ずらした写しを重ねる。影・にじみは付けない
//   大きい音の所＝少し太く・明るい白／小さい音の所＝今くらいの太さで、少し暗い（灰）
const SLICE_LOUD_RANGE = [0.42, 0.58]; // 音の大きさ（0〜1）がこの範囲を超えると、太く・明るい白になる（狭くして、境目をハッキリさせる）
const SLICE_SMOOTH = 4; // 輪郭線・帯は、前後の周波数と平らにならして描く（細かいギザギザで、白い塊にならないように）：前後の本数
const SLICE_QUIET_GRAY = [0.5, 0.3]; // 小さい音の所の輪郭線の明るさ（0〜1）：[いちばん小さい音, 大きい音に足される分]（灰〜白。透けさせずに、暗くする）
const SLICE_QUIET_PX = 0.8; // 小さい音の所の太さ（画面の点〔CSS の点〕）＝これまでの太さ
const SLICE_LOUD_PX = 1.4; // 大きい音の所の太さ（少し太く）
const FILL_ALPHA = [0.05, 0.12]; // 帯（音のある周波数の、中心から輪郭線まで）の濃さ：[小さい音, 大きい音に足される分]。中心から輪郭線まで、同じ濃さ（輪郭線の外には、にじまない）
const SLICE_SILENT_ALPHA = 0.12; // 音の無い所の輪郭線（中心の線）は、ごく薄く

export const VIEWS = {
  iso: { az: 34, el: 24, r: 1 },
  front: { az: 0, el: 3, r: 0.8 },
  side: { az: 90, el: 3, r: 0.8 },
  top: { az: 0, el: 88, r: 0.8 },
};

// ---------- 色 ----------
const INFERNO = [[0, [21, 6, 3]], [0.4, [132, 32, 107]], [0.7, [241, 96, 93]], [1, [252, 255, 164]]]; // もとの配色（中間＝紫・赤）
// 中間（赤）を、黒に近く暗くした配色（midDark で、もとの配色と混ぜる）
const INFERNO_DARK = [[0, [6, 2, 4]], [0.5, [20, 4, 8]], [0.72, [46, 6, 6]], [0.86, [214, 74, 22]], [1, [255, 238, 140]]];
function ramp(stops, t) {
  t = clamp(t, 0, 1);
  for (let i = 0; i < stops.length - 1; i++) {
    const [t0, c0] = stops[i];
    const [t1, c1] = stops[i + 1];
    if (t <= t1) {
      const u = (t - t0) / (t1 - t0 || 1);
      return [0, 1, 2].map((k) => (c0[k] + (c1[k] - c0[k]) * u) / 255);
    }
  }
  return stops[stops.length - 1][1].map((v) => v / 255);
}
const LR_BASE = { left: [0.1, 0.55, 1.0], right: [1.0, 0.55, 0.05] };
function lrColor(side, t) {
  const base = LR_BASE[side];
  const k = 0.22 + 0.78 * Math.pow(clamp(t, 0, 1), 0.9); // 暗い→鮮やか
  const white = clamp((t - 0.72) / 0.28, 0, 1) * 0.75; // 強いところは白っぽく
  return base.map((v) => clamp(v * k * (1 - white) + white, 0, 1));
}

// 3×3 の平均を、passes 回（雑音のギザギザを、少しならして、形を見やすくする）
function smoothed(src, T, B, passes) {
  let a = Float32Array.from(src);
  for (let p = 0; p < passes; p++) {
    const o = new Float32Array(a.length);
    for (let t = 0; t < T; t++) {
      for (let b = 0; b < B; b++) {
        let sum = 0;
        let n = 0;
        for (let dt = -1; dt <= 1; dt++) {
          for (let db = -1; db <= 1; db++) {
            const tt = t + dt;
            const bb = b + db;
            if (tt < 0 || tt >= T || bb < 0 || bb >= B) continue;
            sum += a[tt * B + bb];
            n++;
          }
        }
        o[t * B + b] = sum / n;
      }
    }
    a = o;
  }
  return a;
}

// 周波数の上限（自動）：しっかり鳴っている音（最大の音から約32dB以内＝0.35以上）のある、一番高い周波数に、少し余裕を足す
export function autoMaxHz(data) {
  const { frames: T, bins: B, left, right, topHz } = data;
  let top = 0;
  for (let b = B - 1; b >= 0 && !top; b--) {
    for (let t = 0; t < T; t++) {
      if (left[t * B + b] >= 0.35 || right[t * B + b] >= 0.35) {
        top = b;
        break;
      }
    }
  }
  const hz = ((top + 1) / (B - 1)) * topHz * 1.12;
  return clamp(Math.ceil(hz / 500) * 500, 3000, Math.floor(topHz / 500) * 500);
}

// interactive：false のときは、指・マウスで回す／拡大縮小する操作を付けない（一覧の中に置くとき。ページのスクロールを邪魔しない）
export function createViewer({ canvas, onFrame, onUserRotate, interactive = true }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0c0e12);
  const camera = new THREE.PerspectiveCamera(38, 1, 0.05, 100);
  scene.add(new THREE.AmbientLight(0xffffff, 0.85));
  const sun = new THREE.DirectionalLight(0xffffff, 0.75);
  sun.position.set(2.5, 4, 3.5);
  scene.add(sun);
  const world = new THREE.Group();
  scene.add(world);

  // 設定（画面から set で変える）と、視点の状態
  const S = {
    widthScale: 0.65,
    floor: 0.12,
    colorMode: "inferno", // "inferno"＝音の強さ／"lr"＝左青・右橙
    midDark: 0,
    smooth: 0,
    maxHz: 10000,
    grid: true,
    drawMode: "lines", // "lines"＝線／"surface"＝面／"both"＝面＋線
    lineCount: 80,
    thick: 2, // 線の太さ 1〜4（初期＝ふつう）
    auto: false,
    gamma: 0.85,
    az: VIEWS.iso.az, // 初期＝3D（ななめ）。「2D」ボタンで、横（時間×周波数）にする
    el: VIEWS.iso.el,
    viewR: VIEWS.iso.r,
    zoom: 1,
    sweep: false,
    playT: 0,
    playheadVisible: false, // 再生位置の線：再生中だけ出す
  };
  let data = null;
  let dims = null; // { T, B, D }
  let L = null;
  let R = null;
  let meshes = [];
  let lineObjs = []; // 線で描くとき：時間ごとの輪郭線（左・右。太く見せる写しつき）
  let axesGroup = null;
  let gridWalls = null;
  let playGroup = null;
  let sliceGeoms = []; // 再生位置の、左右の輪郭線（位置・色）
  let sliceGeomsLoud = []; // 大きい音の所だけ、重ねて描く、太く明るい輪郭線（位置は、上と同じものを使う）
  let sliceLines = []; // 輪郭線（太く見せる写しつき）
  let sliceFills = []; // 音のある部分を光らせる帯（左・右）
  let dirty = true;
  let anim = null;
  let stageW = 300;
  let stageH = 300;
  let hudH = 0;
  let raf = 0;
  let disposed = false;

  // ---------- 形 ----------
  function disposeObject(o) {
    o.traverse((c) => {
      c.geometry?.dispose?.();
      c.material?.map?.dispose?.();
      c.material?.dispose?.();
    });
  }
  function disposeWorld() {
    playGroup = null;
    sliceGeoms = [];
    sliceGeomsLoud = [];
    sliceLines = [];
    sliceFills = [];
    gridWalls = null;
    for (const m of meshes) {
      disposeObject(m);
      world.remove(m);
    }
    meshes = [];
    for (const o of lineObjs) {
      disposeObject(o);
      world.remove(o);
    }
    lineObjs = [];
    if (axesGroup) {
      disposeObject(axesGroup);
      world.remove(axesGroup);
      axesGroup = null;
    }
  }
  function resmooth() {
    L = smoothed(data.left, dims.T, dims.B, S.smooth);
    R = smoothed(data.right, dims.T, dims.B, S.smooth);
  }
  function widthOf(a, hz) {
    if (a < S.floor || hz > S.maxHz) return 0;
    return Math.pow((a - S.floor) / (1 - S.floor), S.gamma) * S.widthScale;
  }

  // 線の太さ：画面の上でのずれ（ピクセル）の並べ方。WebGL の線は1ピクセルの細さなので、少しずらした写しを重ねて、太く見せる
  const THICK_PATTERNS = {
    1: [[0, 0]],
    2: [[0, 0], [0.8, 0], [0, 0.8]],
    3: [[0, 0], [1.2, 0], [-1.2, 0], [0, 1.2], [0, -1.2]],
    4: [[0, 0], [1.6, 0], [-1.6, 0], [0, 1.6], [0, -1.6], [1.1, 1.1], [-1.1, 1.1], [1.1, -1.1], [-1.1, -1.1]],
  };
  const MAX_COPIES = 9;
  function buildLines() {
    for (const o of lineObjs) {
      disposeObject(o);
      world.remove(o);
    }
    lineObjs = [];
    const { T, B } = dims;
    const n = Math.max(2, Math.min(S.lineCount, T));
    dims.lineFrames = Array.from({ length: n }, (_, k) => Math.round((k * (T - 1)) / (n - 1)));
    for (const side of ["left", "right"]) {
      const g = new THREE.BufferGeometry();
      const segs = n * (B - 1);
      g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(segs * 2 * 3), 3));
      g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(segs * 2 * 4), 4));
      for (let k = 0; k < MAX_COPIES; k++) {
        const l = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true }));
        l.userData.side = side;
        l.userData.copy = k; // 0＝もとの線／1〜＝少しずらした写し（同じデータを使う）
        l.frustumCulled = false;
        world.add(l);
        lineObjs.push(l);
      }
    }
  }
  function setDrawVisibility() {
    const copies = THICK_PATTERNS[S.thick]?.length ?? 1;
    for (const m of meshes) m.visible = S.drawMode !== "lines";
    for (const o of lineObjs) o.visible = S.drawMode !== "surface" && o.userData.copy < copies;
  }
  // 写しの位置：カメラの右・上の向きへ、ピクセル分だけずらす（どの向きから見ても、同じ太さに見える）
  function layoutLineCopies(dist) {
    if (!lineObjs.length) return;
    const pattern = THICK_PATTERNS[S.thick] ?? THICK_PATTERNS[1];
    const vf = (camera.fov * Math.PI) / 180;
    const pxToWorld = (2 * dist * Math.tan(vf / 2)) / Math.max(stageH, 1);
    const m = camera.matrixWorld.elements;
    for (const o of lineObjs) {
      const off = pattern[o.userData.copy];
      if (!off) continue;
      o.position.set(
        (m[0] * off[0] + m[4] * off[1]) * pxToWorld,
        (m[1] * off[0] + m[5] * off[1]) * pxToWorld,
        (m[2] * off[0] + m[6] * off[1]) * pxToWorld
      );
    }
  }

  // 再生位置の輪郭線の写し（音のある部分を、太く見せる）。線の写しと同じ、ピクセルでのずらし方
  function layoutSliceCopies(dist) {
    if (!sliceLines.length) return;
    const vf = (camera.fov * Math.PI) / 180;
    const dpr = renderer.getPixelRatio();
    const pxToWorld = (2 * dist * Math.tan(vf / 2)) / Math.max(stageH, 1) / dpr; // 画面の1点（デバイスの1ピクセル）ぶんの、世界での長さ
    const m = camera.matrixWorld.elements;
    // ずらす量は、デバイスのピクセルの整数（半端にずらすと、線の縁がぼやける）
    const q = Math.max(1, Math.round(SLICE_QUIET_PX * dpr));
    const l = Math.max(q, Math.round(SLICE_LOUD_PX * dpr));
    // 写しの間の隙間を、途中の位置の写しで、少し埋める（隙間があると、線が、細い線の縞に見える）。q・l が小さいとき（1）は、増やせない
    const hq = q >= 2 ? Math.floor(q / 2) : 0;
    const hl = l >= 3 ? Math.round(l / 3) : 0;
    const patterns = {
      quiet: [[0, 0], [q, 0], [0, q], ...(hq ? [[hq, 0], [0, hq]] : [[q, q]])],
      loud: [[0, 0], [l, 0], [-l, 0], [0, l], [0, -l], ...(hl ? [[hl, 0], [-hl, 0], [0, hl], [0, -hl]] : [])],
    };
    for (const o of sliceLines) {
      const off = patterns[o.userData.kind][o.userData.copy];
      if (!off) continue;
      o.position.set(
        (m[0] * off[0] + m[4] * off[1]) * pxToWorld,
        (m[1] * off[0] + m[5] * off[1]) * pxToWorld,
        (m[2] * off[0] + m[6] * off[1]) * pxToWorld
      );
    }
  }

  function updateGeometry() {
    if (!data) return;
    const { T, B, D } = dims;
    for (const m of meshes) {
      const side = m.userData.side;
      const src = side === "left" ? L : R;
      const sign = side === "left" ? -1 : 1;
      const pos = m.geometry.attributes.position.array;
      const col = m.geometry.attributes.color.array;
      for (let t = 0; t < T; t++) {
        const z = D / 2 - (t / (T - 1)) * D;
        for (let b = 0; b < B; b++) {
          const a = src[t * B + b];
          const i = t * B + b;
          const hz = (b / (B - 1)) * data.topHz;
          const visible = a >= S.floor && hz <= S.maxHz;
          pos[i * 3] = sign * widthOf(a, hz);
          pos[i * 3 + 1] = Math.min(hz / S.maxHz, 1) * H;
          pos[i * 3 + 2] = z;
          let c;
          if (S.colorMode === "lr") {
            c = lrColor(side, a);
          } else {
            c = ramp(INFERNO, a);
            if (S.midDark > 0) {
              const d2 = ramp(INFERNO_DARK, a);
              c = c.map((v, k) => v + (d2[k] - v) * S.midDark);
            }
          }
          col[i * 4] = c[0];
          col[i * 4 + 1] = c[1];
          col[i * 4 + 2] = c[2];
          col[i * 4 + 3] = visible ? 1 : 0;
        }
      }
      m.geometry.attributes.position.needsUpdate = true;
      m.geometry.attributes.color.needsUpdate = true;
      m.geometry.computeVertexNormals();
      m.geometry.computeBoundingSphere();
    }
    // 線（時間ごとの輪郭）
    for (const lo of lineObjs) {
      if (lo.userData.copy) continue; // 写しは、もとの線と、同じデータを使う
      const side = lo.userData.side;
      const src = side === "left" ? L : R;
      const sign = side === "left" ? -1 : 1;
      const pos = lo.geometry.attributes.position.array;
      const col = lo.geometry.attributes.color.array;
      let p = 0;
      let c = 0;
      for (const t of dims.lineFrames) {
        const z = D / 2 - (t / (T - 1)) * D;
        for (let b = 0; b < B - 1; b++) {
          for (const bb of [b, b + 1]) {
            const a = src[t * B + bb];
            const hz = (bb / (B - 1)) * data.topHz;
            const vis = a >= S.floor && hz <= S.maxHz;
            pos[p++] = sign * widthOf(a, hz);
            pos[p++] = Math.min(hz / S.maxHz, 1) * H;
            pos[p++] = z;
            let cc;
            if (S.colorMode === "lr") {
              cc = lrColor(side, a);
            } else {
              cc = ramp(INFERNO, a);
              if (S.midDark > 0) {
                const d2 = ramp(INFERNO_DARK, a);
                cc = cc.map((v, k) => v + (d2[k] - v) * S.midDark);
              }
            }
            col[c++] = Math.min(1, cc[0] * 1.3); // 線は、面より細いので、少し明るく
            col[c++] = Math.min(1, cc[1] * 1.3);
            col[c++] = Math.min(1, cc[2] * 1.3);
            col[c++] = vis ? 1 : 0; // 音の無い所（中心の線）は、見えなくする（薄く残すと、中心に、奥まで続く薄い壁のように見える）
          }
        }
      }
      lo.geometry.attributes.position.needsUpdate = true;
      lo.geometry.attributes.color.needsUpdate = true;
    }
    setDrawVisibility();
    updateSlice();
    dirty = true;
  }

  // ---------- 軸・目盛り・グリッド ----------
  function label(text, { color = "#c9d3df", size = 0.16, bold = false } = {}) {
    const font = `${bold ? "700 " : ""}30px -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif`;
    const c = document.createElement("canvas");
    const g0 = c.getContext("2d");
    g0.font = font;
    const w = Math.max(128, Math.ceil(g0.measureText(text).width) + 24); // 文字の長さに合わせる（切れないように）
    c.width = w;
    c.height = 64;
    const g = c.getContext("2d");
    g.font = font;
    g.fillStyle = color;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(text, w / 2, 34);
    const tex = new THREE.CanvasTexture(c);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
    sp.scale.set(size * (w / 64), size, 1);
    sp.renderOrder = 10;
    return sp;
  }
  function line(points, color = 0x4b5665, opacity = 0.9) {
    const g = new THREE.BufferGeometry().setFromPoints(points.map((p) => new THREE.Vector3(...p)));
    return new THREE.Line(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity }));
  }

  // グリッド線：白い線。床＋壁4面を用意して、視点から見て「奥側」の壁だけを見せる（手前の壁は、グラフに重なって見づらいので描かない）
  function buildGrid(W, D, hzStep, timeStep) {
    const g = new THREE.Group();
    const floor = new THREE.Group();
    const left = new THREE.Group();
    const right = new THREE.Group();
    const back = new THREE.Group();
    const front = new THREE.Group();
    g.add(floor, left, right, back, front);
    const add = (grp, pts, op = 0.6) => grp.add(line(pts, 0xffffff, op));
    const zs = [];
    for (let s = 0; s <= data.duration + 1e-6; s += timeStep) zs.push(D / 2 - (s / data.duration) * D);
    const ys = [];
    for (let hz = 0; hz <= S.maxHz + 1; hz += hzStep) {
      const y = (hz / S.maxHz) * H;
      if (y <= H + 0.001) ys.push(y);
    }
    const xs = [-W, -W / 2, 0, W / 2, W];
    for (const z of zs) add(floor, [[-W, 0, z], [W, 0, z]], 0.55);
    for (const x of xs) add(floor, [[x, 0, -D / 2], [x, 0, D / 2]], 0.35);
    for (const [grp, z] of [[back, -D / 2], [front, D / 2]]) {
      for (const y of ys) add(grp, [[-W, y, z], [W, y, z]]);
      for (const x of xs) add(grp, [[x, 0, z], [x, H, z]], 0.35);
      add(grp, [[-W, H, z], [W, H, z]], 0.35);
    }
    for (const [grp, x] of [[left, -W], [right, W]]) {
      for (const y of ys) add(grp, [[x, y, -D / 2], [x, y, D / 2]]);
      for (const z of zs) add(grp, [[x, 0, z], [x, H, z]]);
      add(grp, [[x, H, -D / 2], [x, H, D / 2]], 0.35);
    }
    gridWalls = { left, right, back, front };
    return g;
  }
  function updateGridVisibility() {
    if (!gridWalls) return;
    const dx = camera.position.x;
    const dz = camera.position.z; // 箱の中心は (0, ·, 0)
    const n = Math.hypot(dx, dz) || 1;
    const far = (dot) => dot / n < -0.08; // 視点と反対側にあるとき
    gridWalls.left.visible = far(-dx);
    gridWalls.right.visible = far(dx);
    gridWalls.back.visible = far(-dz);
    gridWalls.front.visible = far(dz);
  }

  function buildAxes() {
    if (axesGroup) {
      disposeObject(axesGroup);
      world.remove(axesGroup);
    }
    gridWalls = null;
    const { D } = dims;
    const W = S.widthScale + 0.14; // 目盛りの幅：音が一番ひろがったときの幅に、少しだけ余裕
    axesGroup = new THREE.Group();
    const front = D / 2 + 0.12;

    // （中心の区切り線〔床を奥へ・手前を縦に〕は、左右を分ける壁のように見えるので、入れない）
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(W * 2, D),
      new THREE.MeshBasicMaterial({ color: 0x1a2028, transparent: true, opacity: 0.55, side: THREE.DoubleSide })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, -0.005, 0);
    axesGroup.add(floor);

    // 周波数（縦）：左手前
    const fx = -W - 0.05;
    axesGroup.add(line([[fx, 0, front], [fx, H, front]]));
    const hzStep = S.maxHz <= 6000 ? 1000 : 2000;
    for (let hz = 0; hz <= S.maxHz + 1; hz += hzStep) {
      const y = (hz / S.maxHz) * H;
      if (y > H + 0.001) break;
      axesGroup.add(line([[fx, y, front], [fx + 0.07, y, front]]));
      const s = label(hz === 0 ? "0" : `${hz / 1000}kHz`, { size: 0.12 });
      s.position.set(fx - 0.16, y, front);
      axesGroup.add(s);
    }
    const fl = label("周波数", { size: 0.13, color: "#8fb7ff", bold: true });
    fl.position.set(fx - 0.05, H + 0.16, front);
    axesGroup.add(fl);

    // 左右（横）：手前の床
    axesGroup.add(line([[-W, 0, front], [W, 0, front]]));
    for (const x of [-W, -W / 2, 0, W / 2, W]) axesGroup.add(line([[x, 0, front], [x, 0, front + 0.06]]));
    const ll = label("◀ 左", { size: 0.14, color: "#5db0ff", bold: true });
    ll.position.set(-W + 0.25, -0.13, front + 0.05);
    axesGroup.add(ll);
    const rl = label("右 ▶", { size: 0.14, color: "#ffb04d", bold: true });
    rl.position.set(W - 0.25, -0.13, front + 0.05);
    axesGroup.add(rl);
    const cl = label("音が大きいほど、外へひろがる", { size: 0.11, color: "#93a0b0" });
    cl.position.set(0, -0.13, front + 0.05);
    axesGroup.add(cl);

    // 時間（奥行き）：右手前
    const tx = W + 0.05;
    axesGroup.add(line([[tx, 0, D / 2], [tx, 0, -D / 2]]));
    const step = data.duration <= 6 ? 0.5 : data.duration <= 14 ? 1 : data.duration <= 60 ? 5 : 10;
    for (let s = 0; s <= data.duration + 1e-6; s += step) {
      const z = D / 2 - (s / data.duration) * D;
      axesGroup.add(line([[tx, 0, z], [tx + 0.07, 0, z]]));
      const tl = label(`${s % 1 === 0 ? s : s.toFixed(1)}秒`, { size: 0.11 });
      tl.position.set(tx + 0.28, 0.0, z);
      axesGroup.add(tl);
    }
    const tl2 = label("時間（奥へ）", { size: 0.13, color: "#8fe0b0", bold: true });
    tl2.position.set(tx + 0.1, 0.14, -D / 2 - 0.2);
    axesGroup.add(tl2);

    if (S.grid) axesGroup.add(buildGrid(W, D, hzStep, step));
    buildPlayhead(axesGroup, W);
    world.add(axesGroup);
    dirty = true;
  }

  // ---------- 再生位置（白い枠＋その瞬間の左右の音の輪郭＋音のある部分の光る帯） ----------
  //   枠＝いま、どの時刻か。輪郭線と光る帯＝その瞬間に、音が出ている周波数（音の無い所は、光らない）
  function buildPlayhead(parent, Wax) {
    const { B } = dims;
    playGroup = new THREE.Group();
    const frame = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints([[-Wax, 0, 0], [Wax, 0, 0], [Wax, H, 0], [-Wax, H, 0]].map((q) => new THREE.Vector3(...q))),
      new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthTest: false })
    );
    frame.renderOrder = 5;
    playGroup.add(frame);

    sliceGeoms = [];
    sliceGeomsLoud = [];
    sliceLines = [];
    sliceFills = [];
    for (let side = 0; side < 2; side++) {
      // 輪郭線：①小さい音の所を含む、全体（細め・やや暗く）②その上に、大きい音の所だけ、少し太く明るい白（位置は共通）
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(B * 3), 3));
      g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(B * 4), 4));
      sliceGeoms.push(g);
      const gLoud = new THREE.BufferGeometry();
      gLoud.setAttribute("position", g.attributes.position);
      gLoud.setAttribute("color", new THREE.BufferAttribute(new Float32Array(B * 4), 4));
      sliceGeomsLoud.push(gLoud);
      for (const [geom, kind, copies, order] of [[g, "quiet", 5, 8], [gLoud, "loud", 9, 9]]) { // 写しの最大の数（layoutSliceCopies の patterns と合わせる）
        for (let k = 0; k < copies; k++) {
          const l = new THREE.Line(geom, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthTest: false }));
          l.userData.copy = k;
          l.userData.kind = kind;
          l.renderOrder = order;
          l.frustumCulled = false;
          playGroup.add(l);
          sliceLines.push(l);
        }
      }
      // 光る帯（中心から輪郭線まで）。足し算で重ねるので、光って見える
      const fg = new THREE.BufferGeometry();
      fg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(B * 2 * 3), 3));
      fg.setAttribute("color", new THREE.BufferAttribute(new Float32Array(B * 2 * 4), 4));
      const idx = [];
      for (let b = 0; b < B - 1; b++) {
        const i = b * 2;
        idx.push(i, i + 1, i + 2, i + 1, i + 3, i + 2);
      }
      fg.setIndex(idx);
      const fill = new THREE.Mesh(
        fg,
        new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending })
      );
      fill.renderOrder = 6;
      fill.frustumCulled = false;
      playGroup.add(fill);
      sliceFills.push(fill);
    }
    playGroup.visible = S.playheadVisible;
    parent.add(playGroup);
    setPlayhead(S.playT);
  }
  function updateSlice() {
    if (!playGroup || !dims || !sliceGeoms.length) return;
    const { T, B } = dims;
    const u = clamp(S.playT / data.duration, 0, 1);
    const fi = Math.round(u * (T - 1));
    [[L, -1], [R, 1]].forEach(([src, sign], side) => {
      const pos = sliceGeoms[side].attributes.position.array;
      const col = sliceGeoms[side].attributes.color.array;
      const colLoud = sliceGeomsLoud[side].attributes.color.array;
      const fpos = sliceFills[side].geometry.attributes.position.array;
      const fcol = sliceFills[side].geometry.attributes.color.array;
      for (let b = 0; b < B; b++) {
        // 前後の周波数と、平らにならす（音のある所だけの平均。ならした結果が、音のある所の外へ、にじまないように）
        let sum = 0;
        let n = 0;
        for (let d = -SLICE_SMOOTH; d <= SLICE_SMOOTH; d++) {
          const bb = b + d;
          if (bb < 0 || bb >= B) continue;
          sum += src[fi * B + bb];
          n++;
        }
        const a0 = src[fi * B + b];
        const a = a0 >= S.floor ? sum / n : a0;
        const hz = (b / (B - 1)) * data.topHz;
        const x = sign * widthOf(a, hz);
        const y = Math.min(hz / S.maxHz, 1) * H;
        const vis = a >= S.floor && hz <= S.maxHz; // 音がある所
        const k = clamp(a, 0, 1);
        // 輪郭線の位置
        pos[b * 3] = x;
        pos[b * 3 + 1] = y;
        pos[b * 3 + 2] = 0;
        // 小さい音の所：透けさせず、灰色（暗め）で描く。音の無い所は、ごく薄く
        const gray = vis ? Math.min(1, SLICE_QUIET_GRAY[0] + SLICE_QUIET_GRAY[1] * k) : 1;
        col[b * 4] = col[b * 4 + 1] = col[b * 4 + 2] = gray;
        col[b * 4 + 3] = vis ? 1 : SLICE_SILENT_ALPHA;
        // 大きい音の所だけ、その上に、太く明るい白を重ねる（濃さは、ほぼ 0 か 1）
        const lt = clamp((k - SLICE_LOUD_RANGE[0]) / (SLICE_LOUD_RANGE[1] - SLICE_LOUD_RANGE[0]), 0, 1);
        colLoud[b * 4] = colLoud[b * 4 + 1] = colLoud[b * 4 + 2] = 1;
        colLoud[b * 4 + 3] = vis ? lt : 0;
        // 帯：中心から輪郭線まで、同じ濃さ。音の大きい周波数ほど、少し明るい
        const p0 = b * 6; // 位置：1本の周波数につき、2点（中心・輪郭線）×3
        const c0 = b * 8; // 色：2点×4（赤緑青＋濃さ）
        fpos[p0] = 0;
        fpos[p0 + 1] = y;
        fpos[p0 + 2] = 0;
        fpos[p0 + 3] = x;
        fpos[p0 + 4] = y;
        fpos[p0 + 5] = 0;
        const fa = vis ? FILL_ALPHA[0] + FILL_ALPHA[1] * k : 0;
        fcol[c0] = fcol[c0 + 1] = fcol[c0 + 2] = 1;
        fcol[c0 + 3] = fa;
        fcol[c0 + 4] = fcol[c0 + 5] = fcol[c0 + 6] = 1;
        fcol[c0 + 7] = fa;
      }
      sliceGeoms[side].attributes.position.needsUpdate = true;
      sliceGeoms[side].attributes.color.needsUpdate = true;
      sliceGeomsLoud[side].attributes.color.needsUpdate = true;
      sliceFills[side].geometry.attributes.position.needsUpdate = true;
      sliceFills[side].geometry.attributes.color.needsUpdate = true;
    });
    dirty = true;
  }
  function setPlayhead(t) {
    if (!data) return;
    S.playT = clamp(t, 0, data.duration);
    if (!playGroup) return;
    playGroup.position.z = dims.D / 2 - (S.playT / data.duration) * dims.D + 0.004;
    updateSlice();
    dirty = true;
  }

  // ---------- 視点 ----------
  // 再生位置（0〜1）に応じた視点：はじめ＝横、聞き終わり＝ななめ（滑らかに）
  function pathAt(p) {
    const e = p * p * (3 - 2 * p);
    const a = VIEWS.side;
    const b = VIEWS.iso;
    return { az: a.az + (b.az - a.az) * e, el: a.el + (b.el - a.el) * e, r: a.r + (b.r - a.r) * e };
  }
  function animateTo(az, el, r) {
    const from = { az: S.az, el: S.el, r: S.viewR };
    const d = ((az - from.az + 540) % 360) - 180; // 角度は、近い回り方で
    anim = { from, to: { az: from.az + d, el, r }, t0: performance.now(), dur: 500 };
    dirty = true;
  }
  function setView(name) {
    S.sweep = false; // 自分で見る向きを選んだら、再生中の自動の視点の移動は、止める
    const v = VIEWS[name];
    animateTo(v.az, v.el, v.r);
  }
  function startSweep(p) {
    S.sweep = true;
    const c = pathAt(clamp(p, 0, 1));
    animateTo(c.az, c.el, c.r); // いまの視点から、再生位置に合った視点へ、つなぐ（途中から再生しても、飛ばない）
  }
  function endSweep() {
    S.sweep = false;
    animateTo(VIEWS.iso.az, VIEWS.iso.el, VIEWS.iso.r);
  }
  // 場面（目盛りの文字まで含めた箱）が、画面に収まる距離。縦長の画面（スマホ）でも、横が切れないように
  function baseRadius() {
    if (!dims) return 5;
    const Wax = S.widthScale + 0.14;
    const bw = 2 * Wax + 0.75;
    const bh = H + 0.45;
    const bd = dims.D + 0.45;
    const rb = 0.5 * Math.sqrt(bw * bw + bh * bh + bd * bd);
    const vf = (camera.fov * Math.PI) / 180;
    const hf = 2 * Math.atan(Math.tan(vf / 2) * camera.aspect);
    const h = stageH || 1;
    return ((rb / Math.sin(Math.min(vf, hf) / 2)) * 0.8) * (h / Math.max(h - hudH, h * 0.6)); // 上の説明の分だけ、小さく
  }
  // いまの視点（向き）で、箱が画面に収まる距離。長い録音（奥行きが長い）を、縦長の画面で「横」から見ても、はみ出さないように
  function fitRadius(azRad, elRad) {
    if (!dims) return 0;
    const a = S.widthScale + 0.14 + 0.4; // 箱の半分の大きさ（目盛りの文字の分の余裕つき）：左右
    const b = (H + 0.45) / 2; // 縦
    const c = dims.D / 2 + 0.25; // 奥行き
    const rx = Math.cos(azRad);
    const rz = -Math.sin(azRad);
    const ux = -Math.sin(azRad) * Math.sin(elRad);
    const uy = Math.cos(elRad);
    const uz = -Math.cos(azRad) * Math.sin(elRad);
    const dx = Math.sin(azRad) * Math.cos(elRad);
    const dy = Math.sin(elRad);
    const dz = Math.cos(azRad) * Math.cos(elRad);
    const halfW = Math.abs(rx) * a + Math.abs(rz) * c;
    const halfH = (Math.abs(ux) * a + Math.abs(uy) * b + Math.abs(uz) * c) * (stageH / Math.max(stageH - hudH, stageH * 0.6)); // 上の説明の分だけ
    const depth = Math.abs(dx) * a + Math.abs(dy) * b + Math.abs(dz) * c;
    const vf = (camera.fov * Math.PI) / 180;
    const hf = 2 * Math.atan(Math.tan(vf / 2) * camera.aspect);
    return Math.max(halfW / Math.tan(hf / 2), halfH / Math.tan(vf / 2)) + depth;
  }
  function placeCamera() {
    const target = new THREE.Vector3(0, H / 2 - 0.05, 0);
    const az = (S.az * Math.PI) / 180;
    const el = (S.el * Math.PI) / 180;
    // これまでの距離（見慣れた大きさ）と、はみ出さない距離の、大きい方
    const r = Math.max(baseRadius() * S.viewR, fitRadius(az, el)) * S.zoom;
    camera.position.set(target.x + r * Math.cos(el) * Math.sin(az), target.y + r * Math.sin(el), target.z + r * Math.cos(el) * Math.cos(az));
    updateGridVisibility();
    camera.up.set(0, 1, 0);
    camera.lookAt(target);
    camera.updateMatrixWorld();
    layoutLineCopies(r);
    layoutSliceCopies(r);
  }
  function resize(w, h, hudHeight) {
    stageW = Math.max(1, w);
    stageH = Math.max(1, h);
    hudH = Math.min(hudHeight || 0, stageH * 0.4);
    renderer.setSize(stageW, stageH, false);
    camera.aspect = stageW / stageH;
    camera.setViewOffset(stageW, stageH, 0, -hudH / 2, stageW, stageH); // 場面を、上の説明の下の空きに、中央寄せ
    camera.updateProjectionMatrix();
    dirty = true;
  }

  // ---------- 操作（ドラッグで回す・ホイール／ピンチで拡大縮小） ----------
  const pointers = new Map();
  let pinch0 = null;
  const onDown = (e) => {
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // 取れなくても、操作はできる
    }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch0 = { d: Math.hypot(a.x - b.x, a.y - b.y), r: S.zoom };
    }
  };
  const onMove = (e) => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    if (pointers.size === 1) {
      anim = null;
      S.sweep = false; // 手で回したら、再生中の自動の視点の移動は、止める
      S.az -= dx * 0.4;
      S.el = clamp(S.el + dy * 0.4, -6, 89);
      onUserRotate?.();
    } else if (pointers.size === 2 && pinch0) {
      const [a, b] = [...pointers.values()];
      S.zoom = clamp(pinch0.r * (pinch0.d / (Math.hypot(a.x - b.x, a.y - b.y) || 1)), 0.35, 2.5);
    }
    dirty = true;
  };
  const onUp = (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch0 = null;
  };
  const onWheel = (e) => {
    e.preventDefault();
    S.zoom = clamp(S.zoom * Math.exp(e.deltaY * 0.0012), 0.35, 2.5);
    dirty = true;
  };
  if (interactive) {
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });
  }

  // ---------- 描く ----------
  function frame(now) {
    if (disposed) return;
    if (anim) {
      const u = clamp((now - anim.t0) / anim.dur, 0, 1);
      const e = 1 - Math.pow(1 - u, 3);
      S.az = anim.from.az + (anim.to.az - anim.from.az) * e;
      S.el = anim.from.el + (anim.to.el - anim.from.el) * e;
      S.viewR = anim.from.r + (anim.to.r - anim.from.r) * e;
      if (u >= 1) anim = null;
      dirty = true;
    }
    onFrame?.(now);
    if (S.auto && !S.sweep) {
      S.az += 0.25;
      dirty = true;
    }
    if (dirty && data) {
      placeCamera();
      renderer.render(scene, camera);
      dirty = false;
    }
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);

  return {
    // データを入れる。周波数の上限は、録音から自動で計算して返す
    setData(d) {
      data = d;
      dims = { T: d.frames, B: d.bins, D: clamp(d.duration * 0.5, 1.6, 4.6) }; // 奥行き＝時間の長さ
      S.playT = 0;
      resmooth();
      const hz = autoMaxHz(d);
      S.maxHz = hz;
      disposeWorld();
      const { T, B } = dims;
      const idx = [];
      for (let t = 0; t < T - 1; t++) {
        for (let b = 0; b < B - 1; b++) {
          const a = t * B + b;
          const c = (t + 1) * B + b;
          const d2 = t * B + b + 1;
          const e = (t + 1) * B + b + 1;
          idx.push(a, c, d2, d2, c, e);
        }
      }
      for (const side of ["left", "right"]) {
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(T * B * 3), 3));
        g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(T * B * 4), 4));
        g.setIndex(idx);
        const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, alphaTest: 0.5 }));
        m.userData.side = side;
        world.add(m);
        meshes.push(m);
      }
      buildLines();
      updateGeometry();
      buildAxes();
      dirty = true;
      return hz;
    },
    // 設定を変える（変えたものだけ、描き直す）
    set(patch) {
      if (!data) {
        Object.assign(S, patch);
        return;
      }
      const prev = { ...S };
      Object.assign(S, patch);
      if (patch.smooth !== undefined && patch.smooth !== prev.smooth) resmooth();
      if (patch.lineCount !== undefined && patch.lineCount !== prev.lineCount) buildLines();
      const geomChanged = ["widthScale", "floor", "colorMode", "midDark", "smooth", "maxHz", "lineCount"].some((k) => patch[k] !== undefined && patch[k] !== prev[k]);
      if (geomChanged) updateGeometry();
      if (["drawMode", "thick"].some((k) => patch[k] !== undefined && patch[k] !== prev[k])) setDrawVisibility();
      const axesChanged = ["widthScale", "maxHz", "grid"].some((k) => patch[k] !== undefined && patch[k] !== prev[k]);
      if (axesChanged) buildAxes();
      dirty = true;
    },
    setPlayhead,
    // 再生位置の線を、出す・隠す（再生中だけ出す）
    setPlayheadVisible(v) {
      S.playheadVisible = !!v;
      if (playGroup) playGroup.visible = S.playheadVisible;
      dirty = true;
    },
    setView,
    startSweep,
    endSweep,
    // 再生中：再生位置（0〜1）に応じた視点にする（視点の移動が始まっていて、つなぎの動きが終わっているとき）
    updateSweep(p) {
      if (!S.sweep || anim) return;
      const c = pathAt(clamp(p, 0, 1));
      S.az = c.az;
      S.el = c.el;
      S.viewR = c.r;
      dirty = true;
    },
    stopSweep() {
      S.sweep = false;
    },
    isSweeping: () => S.sweep,
    resize,
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("wheel", onWheel);
      disposeWorld();
      renderer.dispose();
      renderer.forceContextLoss?.();
    },
  };
}
