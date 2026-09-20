// 🔥 オフライン保存（iPhone/Androidアプリだけで動く。Web版では何もしない）
//
//   保存するもの：各鳥の「信頼度60%以上の上位7件」の記録データ・音声と、その鳥たちの写真
//   保存先　　　：アプリ専用の領域（端末の Data フォルダ）/ offline / …
//   目録　　　　：offline/manifest.json（何を保存したか。画面は、これを見て保存データに切り替える）
//
//   電波が無い（または5秒以内に応答が無い）ときは、queries.js などが withOfflineFallback を通して
//   保存データに自動で切り替える。Web版・保存が無いときは、今までどおりネットから取得する。

import { Capacitor } from "@capacitor/core";
import { largeImageUrl, LARGE_WIDTH } from "./imageUrl";

const ROOT = "offline";
const MANIFEST_PATH = `${ROOT}/manifest.json`;
const MANIFEST_VERSION = 1;

export const TOP_PER_SPECIES = 7;
export const MIN_CONFIDENCE_PERCENT = 60; // 詳細画面（MinimalBirdModal）の表示条件と同じ
const NETWORK_TIMEOUT_MS = 5000;
const DOWNLOAD_CONCURRENCY = 3;
const DOWNLOAD_RETRIES = 2;

export function isNativeApp() {
  return typeof window !== "undefined" && Capacitor.isNativePlatform();
}

// ネイティブ用の部品は、アプリのときだけ読み込む（Web版を軽く保つ）
async function fsModule() {
  const mod = await import("@capacitor/filesystem");
  return { Filesystem: mod.Filesystem, Directory: mod.Directory, Encoding: mod.Encoding };
}

// ---------- いま端末に保存されている内容（メモリ上の写し） ----------

let loadPromise = null;
let manifest = null; // 保存が無ければ null
let baseUrl = null; // 保存フォルダを、画面（WebView）から読めるURLにしたもの

export function ensureLoaded() {
  if (!isNativeApp()) return Promise.resolve(null);
  if (!loadPromise) loadPromise = loadFromDevice();
  return loadPromise;
}

async function computeBaseUrl(Filesystem, Directory) {
  // 保存フォルダそのものではなく、確実に存在する目録ファイルのURLから逆算する
  const { uri } = await Filesystem.getUri({ path: MANIFEST_PATH, directory: Directory.Data });
  return Capacitor.convertFileSrc(uri.replace(/\/manifest\.json$/, ""));
}

async function loadFromDevice() {
  try {
    const { Filesystem, Directory, Encoding } = await fsModule();
    const res = await Filesystem.readFile({
      path: MANIFEST_PATH,
      directory: Directory.Data,
      encoding: Encoding.UTF8,
    });
    const parsed = JSON.parse(res.data);
    if (parsed?.version === MANIFEST_VERSION) {
      manifest = parsed;
      baseUrl = await computeBaseUrl(Filesystem, Directory);
    }
  } catch {
    manifest = null; // まだ保存していない、または読めない → 保存なし扱い
    baseUrl = null;
  }
  return manifest;
}

function localUrl(relPath) {
  return baseUrl && relPath ? `${baseUrl}/${relPath}` : null;
}

// 保存済みの音声があれば、その端末内のURLを返す（無ければ null）
export function getSavedAudioUrl(wavFilename) {
  return localUrl(manifest?.audio?.[wavFilename]);
}

// 保存済みの写真があれば、その端末内のURLを返す（無ければ null）
export function getSavedImageUrl(originalUrl) {
  return localUrl(manifest?.images?.[originalUrl]);
}

export function getSavedSummary() {
  if (!manifest) return null;
  return {
    savedAt: manifest.savedAt,
    speciesCount: manifest.speciesCount,
    recordCount: manifest.detections.length,
    audioCount: Object.keys(manifest.audio).length,
    imageCount: Object.keys(manifest.images).length,
    bytes: manifest.bytes,
  };
}

// ---------- 「保存データを表示中」の状態（画面に小さく出すため） ----------

let usingSaved = false;
const listeners = new Set();

function setUsingSaved(v) {
  if (usingSaved === v) return;
  usingSaved = v;
  listeners.forEach((fn) => fn(v));
}

export function onUsingSavedChange(fn) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

// ---------- ネット → だめなら保存データ ----------

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("ネットワークの応答がありません")), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}

// networkFn: 今までどおりネットから取る処理 / savedFn(manifest): 保存データから作る処理
export async function withOfflineFallback(networkFn, savedFn) {
  const saved = await ensureLoaded();
  if (!saved) return networkFn(); // Web版・保存なし：今までどおり

  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    setUsingSaved(true); // 機内モードなど：待たずにすぐ保存データへ
    return savedFn(saved);
  }
  try {
    const result = await withTimeout(networkFn(), NETWORK_TIMEOUT_MS);
    setUsingSaved(false);
    return result;
  } catch (err) {
    console.warn("ネットワークが使えないため、保存データを表示します", err);
    setUsingSaved(true);
    return savedFn(saved);
  }
}

// ---------- 何を保存するか ----------

// 各鳥ごとに、信頼度60%以上を信頼度の高い順（同じなら新しい記録が先）で並べ、上位7件を選ぶ
export function selectDetectionsToSave(detections) {
  const bySpecies = new Map();
  for (const d of detections) {
    if (!d.common_name || !d.wav_filename) continue;
    if (Math.round(d.confidence * 100) < MIN_CONFIDENCE_PERCENT) continue;
    if (!bySpecies.has(d.common_name)) bySpecies.set(d.common_name, []);
    bySpecies.get(d.common_name).push(d);
  }
  const selected = [];
  for (const rows of bySpecies.values()) {
    rows.sort(
      (a, b) =>
        b.confidence - a.confidence || (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0)
    );
    selected.push(...rows.slice(0, TOP_PER_SPECIES));
  }
  return selected;
}

// 編集して公開した録音（<元の名前>_e<連番>.mp3）。公開後に「編集し直す」と、同じ名前のまま、中身が変わる
const isEditedAudioName = (name) => /_e\d+\.mp3$/.test(name ?? "");

// ネット上のファイルの大きさ（バイト）。分からないとき（電波が無い・エラー）は 0。
//   Content-Length は、ブラウザの安全のしくみ（CORS）でも、読める
async function remoteSize(url) {
  try {
    const res = await withTimeout(fetch(url, { method: "HEAD", cache: "no-store" }), NETWORK_TIMEOUT_MS);
    if (!res.ok) return 0;
    return Number(res.headers.get("content-length")) || 0;
  } catch {
    return 0;
  }
}

// 端末のファイルの大きさ。無ければ 0
async function localSize(Filesystem, Directory, rel) {
  try {
    const s = await Filesystem.stat({ path: `${ROOT}/${rel}`, directory: Directory.Data });
    return s.size ?? 0;
  } catch {
    return 0;
  }
}

// ダウンロードして、保存先のファイルを入れ替える。途中で止まっても壊れたファイルを残さないよう、
// 別名（.part）に取ってから、古いファイルを消して、名前を付け替える
async function downloadReplacing(Filesystem, Directory, { url, rel, headers }) {
  const partial = `${rel}.part`;
  let lastErr = null;
  for (let attempt = 0; attempt <= DOWNLOAD_RETRIES; attempt++) {
    try {
      await Filesystem.downloadFile({ url, path: `${ROOT}/${partial}`, directory: Directory.Data, recursive: true, headers });
      try {
        await Filesystem.deleteFile({ path: `${ROOT}/${rel}`, directory: Directory.Data }); // 古い版（無ければ、何もしない）
      } catch {
        // まだ無いだけ
      }
      await Filesystem.rename({ from: `${ROOT}/${partial}`, to: `${ROOT}/${rel}`, directory: Directory.Data, toDirectory: Directory.Data });
      return;
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
    }
  }
  throw lastErr;
}

function safeFileName(url) {
  const last = decodeURIComponent(url.split("?")[0].split("/").pop() || "file");
  return last.replace(/[^A-Za-z0-9._-]/g, "_");
}

async function runPool(tasks, worker, shouldStop) {
  let next = 0;
  const runners = Array.from({ length: Math.min(DOWNLOAD_CONCURRENCY, tasks.length) }, async () => {
    while (next < tasks.length && !shouldStop()) {
      const task = tasks[next++];
      await worker(task);
    }
  });
  await Promise.all(runners);
}

// ---------- 保存する ----------
//   detections / birdImages は「ネットから取った最新のもの」を、呼び出し側が渡す
//   onProgress({ done, total }) で進み具合を伝える
export async function saveOffline({ detections, birdImages, getRemoteAudioUrl, onProgress }) {
  if (!isNativeApp()) throw new Error("オフライン保存は、アプリでのみ使えます");
  const { Filesystem, Directory, Encoding } = await fsModule();
  await ensureLoaded();

  const selected = selectDetectionsToSave(detections);
  const species = new Set(selected.map((d) => d.common_name));
  const images = birdImages.filter((b) => b.image_url && species.has(b.common_name));

  const audioTasks = [...new Set(selected.map((d) => d.wav_filename))].map((wav) => ({
    kind: "audio",
    key: wav,
    url: getRemoteAudioUrl(wav),
    rel: `audio/${wav}`,
  }));
  // 写真は、軽く縮小した詳細用（幅1200px・WebP）を保存する。元の写真（PNG・最大8MB）は保存しない。
  // 目録では、元の写真のURLをキーにする（画面は、元のURLから保存済みの写真を探す）。
  // 保存名を新しくするので、以前に保存した大きな写真は、保存の後に自動で消える
  const imageTasks = [...new Set(images.map((b) => b.image_url))].map((url) => ({
    kind: "image",
    key: url,
    url: largeImageUrl(url),
    // 保存名の「fit」は、縦横の比率を保って縮小した版という印。以前の切り抜き版（_w1200.webp）と名前を分けて、
    // 「更新」で、正しい版に入れ替わる（古い切り抜き版は、保存の後に自動で消える）
    rel: `images/${safeFileName(url).replace(/\.[^.]+$/, "")}_w${LARGE_WIDTH}fit.webp`,
    headers: { Accept: "image/webp,image/*;q=0.8,*/*;q=0.5" }, // WebP で返してもらう
  }));
  const tasks = [...audioTasks, ...imageTasks];

  // ダウンロード先のフォルダを先に作っておく（Androidでは、downloadFile の recursive 指定が効かないため）
  for (const dir of ["audio", "images"]) {
    try {
      await Filesystem.mkdir({ path: `${ROOT}/${dir}`, directory: Directory.Data, recursive: true });
    } catch {
      // すでにある場合は、エラーになるだけなので何もしない
    }
  }

  let done = 0;
  let bytes = 0;
  let failure = null;
  const report = () => onProgress?.({ done, total: tasks.length });
  report();

  async function fileSize(rel) {
    try {
      const s = await Filesystem.stat({ path: `${ROOT}/${rel}`, directory: Directory.Data });
      return s.size ?? 0;
    } catch {
      return 0;
    }
  }

  async function downloadOne(task) {
    // すでに保存済みなら、ダウンロードしない。ただし、編集して公開した録音は、編集し直すと中身が変わるので、
    // ネット上の大きさと違えば、入れ替える
    let size = await fileSize(task.rel);
    let stale = false;
    if (size > 0 && task.kind === "audio" && isEditedAudioName(task.key)) {
      const remote = await remoteSize(task.url);
      stale = remote > 0 && remote !== size;
    }
    if (size === 0 || stale) {
      await downloadReplacing(Filesystem, Directory, task);
      size = await fileSize(task.rel);
    }
    bytes += size;
    done += 1;
    report();
  }

  await runPool(
    tasks,
    async (task) => {
      try {
        await downloadOne(task);
      } catch (err) {
        failure = failure ?? err;
        throw err;
      }
    },
    () => failure !== null
  );
  if (failure) throw failure;

  const next = {
    version: MANIFEST_VERSION,
    savedAt: new Date().toISOString(),
    speciesCount: species.size,
    bytes,
    detections: selected,
    birdImages: images.map((b) => ({ common_name: b.common_name, image_url: b.image_url })),
    audio: Object.fromEntries(audioTasks.map((t) => [t.key, t.rel])),
    images: Object.fromEntries(imageTasks.map((t) => [t.key, t.rel])),
  };

  // 目録は、すべてのダウンロードが終わってから書く（途中で失敗しても、前回の保存はそのまま使える）
  await Filesystem.writeFile({
    path: MANIFEST_PATH,
    directory: Directory.Data,
    encoding: Encoding.UTF8,
    data: JSON.stringify(next),
    recursive: true,
  });
  manifest = next;
  baseUrl = await computeBaseUrl(Filesystem, Directory);
  loadPromise = Promise.resolve(manifest);

  await removeUnreferencedFiles(Filesystem, Directory, next);
  return getSavedSummary();
}

// ---------- 保存済みの、編集した録音を、最新にする ----------
//   編集して公開した録音は、「編集し直す」と、同じ名前のまま、中身が変わる。保存済みのコピーが古いままだと、
//   アプリでは、編集前の音（とスペクトログラム）が出てしまうので、ネット上の大きさと違うものを、入れ替える。
//   names を渡すと、その録音だけ。無ければ、保存済みの、編集した録音すべて。電波が無いときは、何もしない。
//   getRemoteAudioUrl: 録音の名前 → ネット上の URL。戻り値：入れ替えた録音の名前の配列
export async function refreshEditedAudio({ names, getRemoteAudioUrl }) {
  if (!isNativeApp()) return [];
  const saved = await ensureLoaded();
  if (!saved?.audio) return [];
  const targets = (names ?? Object.keys(saved.audio)).filter((n) => saved.audio[n] && isEditedAudioName(n));
  if (targets.length === 0) return [];
  const { Filesystem, Directory } = await fsModule();
  const refreshed = [];
  for (const name of targets) {
    const rel = saved.audio[name];
    const url = getRemoteAudioUrl(name);
    try {
      const remote = await remoteSize(url);
      if (remote === 0) continue; // 電波が無い・取得できない：保存済みのまま
      if ((await localSize(Filesystem, Directory, rel)) === remote) continue; // 同じ：入れ替え不要
      await downloadReplacing(Filesystem, Directory, { url, rel });
      refreshed.push(name);
    } catch (err) {
      console.warn("保存済みの録音を最新にできませんでした", name, err);
    }
  }
  return refreshed;
}

// 今回の目録に載っていない古いファイル（と途中の .part）を、保存フォルダから消す
async function removeUnreferencedFiles(Filesystem, Directory, m) {
  const keep = {
    audio: new Set(Object.values(m.audio).map((r) => r.replace("audio/", ""))),
    images: new Set(Object.values(m.images).map((r) => r.replace("images/", ""))),
  };
  for (const dir of ["audio", "images"]) {
    try {
      const { files } = await Filesystem.readdir({ path: `${ROOT}/${dir}`, directory: Directory.Data });
      for (const f of files) {
        if (f.type === "file" && !keep[dir].has(f.name)) {
          await Filesystem.deleteFile({ path: `${ROOT}/${dir}/${f.name}`, directory: Directory.Data });
        }
      }
    } catch {
      // フォルダがまだ無いだけ。何もしない
    }
  }
}

// ---------- 保存を削除する ----------
export async function clearOffline() {
  if (!isNativeApp()) return;
  const { Filesystem, Directory } = await fsModule();
  try {
    await Filesystem.rmdir({ path: ROOT, directory: Directory.Data, recursive: true });
  } catch {
    // もともと無ければ何もしない
  }
  manifest = null;
  baseUrl = null;
  loadPromise = Promise.resolve(null);
  setUsingSaved(false);
}
