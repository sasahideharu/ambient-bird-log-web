// 🔥 録音を、この端末の中に保存する（アプリ：端末の Data フォルダ）。電波が無くても録音できるように、まず、端末の中だけに置く。
//
//   recordings/<id>/meta.json   … 録音の情報（いつ・誰が・何の機材で・どこで・音の形式…）
//   recordings/<id>/audio.pcm   … 無圧縮の音（16bit・モノラル・生のデータ。サンプルレートは meta に）
//   recordings/<id>/audio.m4a   … 別の録音（AAC・画面を消しても続く保険）
//
//   ・音は、少しずつ書き足す（途中でアプリが止まっても、そこまでの音は残る）。書き足しは、順番に（直列に）行う
//   ・ブラウザ（アプリ以外）では、メモリに置く（試験用。ページを閉じると消える）

import { Capacitor } from "@capacitor/core";
import { bytesToBase64 } from "./base64";

const ROOT = "recordings";
const FILES = { pcm: "audio.pcm", aac: "audio.m4a" };

const isNative = () => Capacitor.isNativePlatform();

async function fs() {
  const mod = await import("@capacitor/filesystem");
  return { Filesystem: mod.Filesystem, Directory: mod.Directory, Encoding: mod.Encoding };
}

// ブラウザ用（試験）のメモリ
const mem = new Map(); // id → { meta, pcm: Uint8Array[], aac: Uint8Array[] }

export function newId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

const dirOf = (id) => `${ROOT}/${id}`;

export async function createRecording(meta) {
  if (!isNative()) {
    mem.set(meta.id, { meta: structuredClone(meta), pcm: [], aac: [] });
    return;
  }
  const { Filesystem, Directory, Encoding } = await fs();
  await Filesystem.mkdir({ path: dirOf(meta.id), directory: Directory.Data, recursive: true });
  await Filesystem.writeFile({
    path: `${dirOf(meta.id)}/meta.json`,
    directory: Directory.Data,
    encoding: Encoding.UTF8,
    data: JSON.stringify(meta),
  });
}

export async function writeMeta(meta) {
  if (!isNative()) {
    const e = mem.get(meta.id);
    if (e) e.meta = structuredClone(meta);
    return;
  }
  const { Filesystem, Directory, Encoding } = await fs();
  await Filesystem.writeFile({
    path: `${dirOf(meta.id)}/meta.json`,
    directory: Directory.Data,
    encoding: Encoding.UTF8,
    data: JSON.stringify(meta),
  });
}

// 音のバイト列を、ファイルの終わりに書き足す。kind："pcm"（無圧縮）| "aac"（別の録音）
export async function appendBytes(id, kind, bytes) {
  if (!bytes?.length) return;
  if (!isNative()) {
    mem.get(id)?.[kind].push(bytes.slice());
    return;
  }
  const { Filesystem, Directory } = await fs();
  const path = `${dirOf(id)}/${FILES[kind]}`;
  const data = bytesToBase64(bytes);
  try {
    await Filesystem.appendFile({ path, directory: Directory.Data, data });
  } catch (err) {
    // ファイルがまだ無いとき（最初の書き込み）だけ、作って書く。ファイルがあるのに失敗したとき（容量不足など）は、
    // 上書きして、すでにある音を失わないよう、そのまま、失敗として伝える
    let exists = true;
    try {
      await Filesystem.stat({ path, directory: Directory.Data });
    } catch {
      exists = false;
    }
    if (exists) throw err;
    await Filesystem.writeFile({ path, directory: Directory.Data, data });
  }
}

// 保存してある録音の一覧（新しい順）。meta が壊れているものは、飛ばす
export async function listRecordings() {
  if (!isNative()) {
    return [...mem.values()].map((e) => e.meta).sort((a, b) => b.startedAtMs - a.startedAtMs);
  }
  const { Filesystem, Directory, Encoding } = await fs();
  let dirs = [];
  try {
    const r = await Filesystem.readdir({ path: ROOT, directory: Directory.Data });
    dirs = r.files.filter((f) => f.type === "directory").map((f) => f.name);
  } catch {
    return []; // まだ録音が無い
  }
  const metas = [];
  for (const id of dirs) {
    try {
      const r = await Filesystem.readFile({ path: `${dirOf(id)}/meta.json`, directory: Directory.Data, encoding: Encoding.UTF8 });
      const meta = JSON.parse(r.data);
      // ファイルの大きさは、実際のファイルから（録音中に止まったものでも、正しい大きさが出る）
      meta._files = {};
      for (const kind of Object.keys(FILES)) {
        try {
          const s = await Filesystem.stat({ path: `${dirOf(id)}/${FILES[kind]}`, directory: Directory.Data });
          meta._files[kind] = s.size ?? 0;
        } catch {
          meta._files[kind] = 0;
        }
      }
      metas.push(meta);
    } catch {
      // 壊れている・書き込み中
    }
  }
  return metas.sort((a, b) => (b.startedAtMs ?? 0) - (a.startedAtMs ?? 0));
}

export async function deleteRecording(id) {
  if (!isNative()) {
    mem.delete(id);
    return;
  }
  const { Filesystem, Directory } = await fs();
  await Filesystem.rmdir({ path: dirOf(id), directory: Directory.Data, recursive: true });
}

// 聞くための URL（別の録音＝AAC は、そのまま再生できる）。無ければ null
export async function playableUrl(id, kind = "aac") {
  if (!isNative()) {
    const parts = mem.get(id)?.[kind];
    if (!parts?.length) return null;
    return URL.createObjectURL(new Blob(parts, { type: kind === "aac" ? "audio/mp4" : "application/octet-stream" }));
  }
  const { Filesystem, Directory } = await fs();
  try {
    const { uri } = await Filesystem.getUri({ path: `${dirOf(id)}/${FILES[kind]}`, directory: Directory.Data });
    return Capacitor.convertFileSrc(uri);
  } catch {
    return null;
  }
}
