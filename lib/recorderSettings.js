// 🔥 録音の設定（この端末に保存）：録音者名・デフォルトの場所。
//    デフォルトの場所は、位置情報（GPS）が取れなかったときに、録音の場所として使う（緯度経度）。

const KEY = "abl.recorder.settings";

const DEFAULTS = { recorderName: "", defaultLocation: null };

export function loadSettings() {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const s = JSON.parse(raw);
    const dl = s.defaultLocation;
    const okLoc = dl && Number.isFinite(dl.latitude) && Number.isFinite(dl.longitude);
    return {
      recorderName: typeof s.recorderName === "string" ? s.recorderName : "",
      defaultLocation: okLoc ? { name: String(dl.name ?? ""), latitude: dl.latitude, longitude: dl.longitude } : null,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(settings) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(settings));
    return true;
  } catch {
    return false; // 保存できない環境（プライベートモードなど）
  }
}
