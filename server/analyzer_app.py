"""Ambient Bird Log の解析サーバー（Modal）。BirdNET で MP3・WAV を解析して、結果（3秒ごとの記録）を返す。
別のモデル Perch 2.0（Google・Apache-2.0）も動かせる（perch＝True）：5秒ごとに、上位5種を返す（「別モデルの意見」用）。

・このサーバーは、記録を書き込まない（データベースの鍵も持たない）。解析して、結果を返すだけ。
  書き込みは、画面（ログイン中の管理者）が、自分の権限で行う（データベース側で「管理者名簿にいる人だけ」に制限済み）
・呼び出せるのは、ログイン中の管理者だけ。ログインのトークン（Supabase）と、管理者名簿で確認する。
  確認は、軽い「門番」の関数で行い、通ったときだけ、重い解析の関数を動かす（不正な呼び出しで、重い処理が動かないように）
・解析するファイルは、保管場所（bird-wav）の MP3 か WAV。名前で指定する（ファイルそのものは受け取らない）
  WAV は、画面（ブラウザ）が、48kHz・16bit に変換して、一時的に保存したもの（解析が終わったら、画面が消す）

デプロイ（公開）: server/.venv/bin/python -m modal deploy server/analyzer_app.py
試験（何も書き込まない）: server/.venv/bin/python -m modal run server/analyzer_app.py::selftest
"""

import modal

# ---------- 設定 ----------
BIRDNET_VERSION = "2.4.0"
MODEL_NAME = "BirdNET"
MODEL_VERSION = "2.4"
SUPABASE_URL = "https://ecqdejnbfqkhpaolpgat.supabase.co"
AUDIO_BUCKET = "bird-wav"

# Perch 2.0（CPU 版・TensorFlow の SavedModel）。画像の中に入れてある（公式：Kaggle の google/bird-vocalization-classifier）
PERCH_DIR = "/models/perch_v2_cpu"
PERCH_MODEL_NAME = "Perch"
PERCH_MODEL_VERSION = "2.0"
PERCH_SAMPLE_RATE = 32000
PERCH_WINDOW_SEC = 5.0
PERCH_TOP_K = 5
# 学名の表記が違う種（BirdNET の学名 → Perch のラベル）。Perch は、Parus minor（シジュウカラ）を持たず、Parus major／cinereus に含める
BIRDNET_TO_PERCH = {"Parus minor": ["Parus major", "Parus cinereus"]}
PERCH_TO_BIRDNET = {p: b for b, ps in BIRDNET_TO_PERCH.items() for p in ps}

# 画面（ブラウザ）から呼ぶときに許可する接続元（本番・手元の確認・iPhone/Android アプリ）
ALLOWED_ORIGINS = [
    "https://ambient-bird-log-web.vercel.app",
    "http://localhost:3100",
    "http://127.0.0.1:3100",
    "http://localhost:3000",
    "capacitor://localhost",
    "https://localhost",
    "http://localhost",
]

MAX_FILES_PER_REQUEST = 10  # 1回の呼び出しで解析する MP3 の数（門番のタイムアウトに収めるため）
MAX_FILE_BYTES = 20 * 1024 * 1024  # 1ファイルの大きさの上限（MP3 は通常 0.3〜1MB・48kHz/16bit のステレオ WAV は 1秒 約0.19MB＝約100秒まで）

# ---------- 実行環境（画像） ----------
# 解析用：BirdNET（TensorFlow）と、モデル本体（初回に約224MBをダウンロードするため、画像を作るときに1回動かして、中に入れておく）
analysis_image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg", "libsndfile1")
    .pip_install(f"birdnet-analyzer=={BIRDNET_VERSION}", "requests", "kagglehub", "numpy")
    .run_commands(
        "ffmpeg -loglevel error -f lavfi -i anullsrc=r=48000:cl=mono -t 3 /tmp/warm.wav",
        "birdnet-analyze /tmp/warm.wav -o /tmp/warm_out --min_conf 0.99 --rtype csv",
        "rm -rf /tmp/warm.wav /tmp/warm_out",
    )
    # 公式の Perch 2.0（CPU 版）を、Kaggle（Google）から、画像の中に入れておく（birdnet-analyzer の --use_perch と同じ取り方）
    .run_commands(
        "python -c \"import kagglehub, shutil; p = kagglehub.model_download('google/bird-vocalization-classifier/tensorFlow2/perch_v2_cpu'); "
        "shutil.copytree(p, '/models/perch_v2_cpu')\""
    )
)

# 門番用：軽い（TensorFlow なし）
gateway_image = modal.Image.debian_slim(python_version="3.11").pip_install("fastapi[standard]", "requests")

app = modal.App("ambient-bird-log-analyzer")


# ---------- 共通の部品 ----------
def count_channels(path: str) -> int:
    """音声ファイルの、チャンネル数（モノラル＝1、ステレオ＝2）。読めなければ 1"""
    import subprocess

    r = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "a:0", "-show_entries", "stream=channels", "-of", "csv=p=0", path],
        capture_output=True,
        text=True,
    )
    try:
        return int(r.stdout.strip().splitlines()[0])
    except (ValueError, IndexError):
        return 1


def read_result_rows(path: str) -> list:
    """BirdNET の結果（CSV）を、記録の形（辞書）の一覧にする。ファイルが無ければ、空"""
    import csv
    import os

    rows = []
    if not os.path.exists(path):
        return rows
    with open(path, encoding="utf-8-sig") as f:
        for r in csv.DictReader(f):
            rows.append(
                {
                    "start_sec": float(r["Start (s)"]),
                    "end_sec": float(r["End (s)"]),
                    "scientific_name": r["Scientific name"],
                    "common_name": r["Common name"],
                    "confidence": float(r["Confidence"]),
                }
            )
    return rows


def merge_best(rows_by_channel: dict) -> tuple:
    """同じ（区間・鳥）について、混ぜた音・左・右の結果のうち、信頼度が一番高いものを採る。
    戻り値：（記録の一覧、混ぜた音より、増えた・高くなった記録の数）"""
    merged = {}
    for rows in rows_by_channel.values():
        for r in rows:
            key = (r["start_sec"], r["end_sec"], r["scientific_name"])
            if key not in merged or r["confidence"] > merged[key]["confidence"]:
                merged[key] = dict(r)
    mix = {(r["start_sec"], r["end_sec"], r["scientific_name"]): r["confidence"] for r in rows_by_channel.get("mix", [])}
    gained = sum(1 for key, r in merged.items() if key not in mix or r["confidence"] > mix[key] + 1e-9)
    ordered = sorted(merged.values(), key=lambda r: (r["start_sec"], r["scientific_name"]))
    return ordered, gained

def week_from_filename(name: str):
    """ファイル名の先頭 YYMMDD（例 260712_043_Tr1.mp3）から、BirdNET の週（1〜48。1か月を4週）を求める。読めなければ None"""
    import re

    m = re.match(r"^(\d{2})(\d{2})(\d{2})_", name)
    if not m:
        return None
    month, day = int(m.group(2)), int(m.group(3))
    if not (1 <= month <= 12 and 1 <= day <= 31):
        return None
    return (month - 1) * 4 + min(4, (day - 1) // 7 + 1)


def run_perch_analysis(file_paths: dict, file_week: dict, location, sf_thresh: float, results: dict) -> dict:
    """Perch 2.0 で、各録音を5秒ごとに解析して、上位5種を、results[名前]["perch"] に入れる。
    ・場所（location）があれば、BirdNET と同じ「その場所・その時期の種の一覧」に絞る（Perch には、場所の絞り込みが無いため）
    ・種の名前は、BirdNET の学名に直す（Perch の Parus major／cinereus → Parus minor）。日本語名は、BirdNET のラベルから
    ・点数：logit（確かな検出は 9〜12・雑音は 4〜7 の目安）と、絞った種のなかでの確率（softmax）
    戻り値：meta に入れる、Perch の情報"""
    import csv
    import math
    import os
    import subprocess

    import birdnet_analyzer.config as cfg
    import numpy as np
    import tensorflow as tf
    from birdnet_analyzer import utils as bn_utils
    from birdnet_analyzer.species.utils import get_species_list

    labels = [r[0] for r in csv.reader(open(os.path.join(PERCH_DIR, "assets", "labels.csv"), encoding="utf-8"))][1:]  # 1行目は見出し
    index = {name: i for i, name in enumerate(labels)}
    infer = tf.saved_model.load(PERCH_DIR).signatures["serving_default"]

    # 日本語名（BirdNET のラベル：学名_日本語名）
    ja = {}
    ja_file = os.path.join(cfg.TRANSLATED_LABELS_PATH, "BirdNET_GLOBAL_6K_V2.4_Labels_ja.txt")
    if os.path.exists(ja_file):
        for line in open(ja_file, encoding="utf-8"):
            sci, _, common = line.strip().partition("_")
            ja[sci] = common

    # 「場所＋時期の種の一覧」を出す準備（birdnet_analyzer.species.utils.run と同じ）
    cfg.MODEL_PATH = cfg.BIRDNET_MODEL_PATH
    cfg.LABELS_FILE = cfg.BIRDNET_LABELS_FILE
    cfg.SAMPLE_RATE = cfg.BIRDNET_SAMPLE_RATE
    cfg.SIG_LENGTH = cfg.BIRDNET_SIG_LENGTH
    cfg.LABELS = bn_utils.read_lines(cfg.LABELS_FILE)

    species_cache = {}

    def allowed_for(week):
        """（BirdNET の種の一覧〔学名の集合〕, Perch のラベルの番号の並び）。場所が無ければ、None"""
        if not location:
            return None
        if week not in species_cache:
            sci_list = {x.split("_", 1)[0] for x in get_species_list(location["lat"], location["lon"], week, threshold=sf_thresh)}
            idx = set()
            for sci in sci_list:
                if sci in index:
                    idx.add(index[sci])
                for p in BIRDNET_TO_PERCH.get(sci, []):
                    if p in index:
                        idx.add(index[p])
            species_cache[week] = (sci_list, np.array(sorted(idx), dtype=np.int64))
        return species_cache[week]

    win = int(PERCH_SAMPLE_RATE * PERCH_WINDOW_SEC)
    for name, path in file_paths.items():
        try:
            raw = subprocess.run(
                ["ffmpeg", "-v", "error", "-i", path, "-ac", "1", "-ar", str(PERCH_SAMPLE_RATE), "-f", "f32le", "-"],
                capture_output=True,
            ).stdout
            audio = np.frombuffer(raw, dtype=np.float32)
            if len(audio) == 0:
                results[name]["perch"] = {"error": "音声を読めませんでした", "windows": []}
                continue
            n = max(1, math.ceil(len(audio) / win))
            padded = np.zeros(n * win, dtype=np.float32)
            padded[: len(audio)] = audio
            batch = padded.reshape(n, win)
            logits = np.concatenate(
                [infer(inputs=tf.constant(batch[i : i + 8]))["label"].numpy() for i in range(0, n, 8)], axis=0
            )
            allowed = allowed_for(file_week.get(name, -1))
            sci_list = allowed[0] if allowed else None
            idx = allowed[1] if allowed else np.arange(len(labels))
            windows = []
            for w in range(n):
                z = logits[w][idx]
                e = np.exp(z - z.max())
                prob = e / e.sum()
                merged = {}  # BirdNET の学名 → { logit（大きい方）, prob（足し算） }
                for j in np.argsort(-z)[:20]:
                    label = labels[idx[j]]
                    sci = PERCH_TO_BIRDNET.get(label, label) if (sci_list is None or PERCH_TO_BIRDNET.get(label) in sci_list) else label
                    m = merged.setdefault(sci, {"logit": float(z[j]), "prob": 0.0})
                    m["logit"] = max(m["logit"], float(z[j]))
                    m["prob"] += float(prob[j])
                top = sorted(merged.items(), key=lambda kv: -kv[1]["logit"])[:PERCH_TOP_K]
                windows.append(
                    {
                        "t0": w * PERCH_WINDOW_SEC,
                        "t1": round(min((w + 1) * PERCH_WINDOW_SEC, len(audio) / PERCH_SAMPLE_RATE), 2),
                        "top": [
                            {"sci": sci, "common": ja.get(sci), "logit": round(v["logit"], 2), "prob": round(v["prob"], 4)}
                            for sci, v in top
                        ],
                    }
                )
            results[name]["perch"] = {"windows": windows, "species_in_list": int(len(idx))}
        except Exception as err:  # 1本の失敗で、全体を止めない
            results[name]["perch"] = {"error": f"Perch の解析に失敗しました（{type(err).__name__}）", "windows": []}
    return {
        "model_name": PERCH_MODEL_NAME,
        "model_version": PERCH_MODEL_VERSION,
        "variant": "perch_v2_cpu",
        "window_sec": PERCH_WINDOW_SEC,
        "top_k": PERCH_TOP_K,
        "location_filter": bool(location),
        "sf_thresh": sf_thresh if location else None,
    }


# ---------- 重い解析（BirdNET・Perch） ----------
@app.function(image=analysis_image, cpu=2, memory=6144, timeout=600)
def analyze_batch(request: dict) -> dict:
    """MP3・WAV（名前で指定）を、BirdNET で解析して、結果を返す。何も書き込まない。

    request:
      files:      MP3・WAV の名前の一覧（保管場所 bird-wav にあるもの。拡張子は小文字の .mp3 か .wav）
      min_conf:   信頼度の下限（標準 0.25）
      location:   {"lat": 緯度, "lon": 経度} … 場所の絞り込み。None なら絞り込みなし
      use_week:   True なら、録音の日付（ファイル名の YYMMDD）から週を求めて、時期でも絞り込む
      sf_thresh:  絞り込みの基準（標準 0.03）
      stereo:     "best"（標準）＝ステレオは、左右を別々にも解析して、（混ぜた音・左・右の）信頼度が一番高いものを採る
                  "mix"＝左右を混ぜた1つの音だけを解析する（BirdNET の標準の動き・Mac の BirdNET の画面と同じ）
                  ※左右のマイクが離れている録音は、左右がほぼ無関係な音になり、混ぜると、鳥の声が弱くなることがある
      birdnet:    False なら、BirdNET を動かさない（Perch だけを動かしたいとき）。標準 True
      perch:      True なら、Perch 2.0 も動かして、5秒ごとの上位5種を、各ファイルの "perch" に入れる（左右は混ぜた音）。標準 False
    """
    import csv
    import glob
    import os
    import subprocess
    import tempfile
    import time
    from datetime import datetime, timezone

    import requests

    started = time.time()
    files = request["files"]
    min_conf = float(request.get("min_conf", 0.25))
    location = request.get("location")
    use_week = bool(request.get("use_week", True))
    sf_thresh = float(request.get("sf_thresh", 0.03))
    stereo = request.get("stereo", "best")
    run_birdnet = bool(request.get("birdnet", True))
    run_perch = bool(request.get("perch", False))

    work = tempfile.mkdtemp()
    results = {}
    warnings = []

    # ① 保管場所から MP3・WAV を取ってくる
    groups = {}  # 週 → [ファイル名]（同じ週のものは、まとめて解析する）
    channel_info = {}  # ファイル名 → { channels：チャンネル数, derived：左右を分けて作ったチャンネルの印（"L"・"R"） }
    file_paths = {}  # ファイル名 → 取ってきたファイルの場所（Perch 用）
    file_week = {}  # ファイル名 → 週（-1＝時期の絞り込みなし）
    for name in files:
        res = requests.get(f"{SUPABASE_URL}/storage/v1/object/public/{AUDIO_BUCKET}/{name}", timeout=60)
        if res.status_code != 200:
            results[name] = {"error": f"保管場所から取得できませんでした（{res.status_code}）", "rows": []}
            continue
        if len(res.content) > MAX_FILE_BYTES:
            results[name] = {"error": "ファイルが大きすぎます", "rows": []}
            continue
        week = -1
        if location and use_week:
            w = week_from_filename(name)
            if w is None:
                warnings.append(f"{name}: 日付を読み取れないため、時期の絞り込みは使いません（場所のみ）")
            else:
                week = w
        groups.setdefault(week, []).append(name)
        in_dir = os.path.join(work, f"in_w{week}")
        os.makedirs(in_dir, exist_ok=True)
        file_path = os.path.join(in_dir, name)
        with open(file_path, "wb") as f:
            f.write(res.content)
        file_paths[name] = file_path
        file_week[name] = week

        # ステレオ（"best"）：左右を別々の音（モノラルの WAV）にして、同じフォルダに置く＝同じ1回の実行で、一緒に解析される
        n_ch = count_channels(file_path)
        derived = []
        if run_birdnet and stereo == "best" and n_ch == 2:
            stem = os.path.splitext(name)[0]
            for idx, tag in enumerate(("L", "R")):
                out_wav = os.path.join(in_dir, f"{stem}__ch{tag}.wav")
                pr = subprocess.run(
                    ["ffmpeg", "-y", "-v", "error", "-i", file_path, "-af", f"pan=mono|c0=c{idx}", "-c:a", "pcm_s16le", out_wav],
                    capture_output=True,
                )
                if pr.returncode == 0:
                    derived.append(tag)
        channel_info[name] = {"channels": n_ch, "derived": derived}

    # ② 週ごとに、BirdNET を1回動かす（モデルの読み込みは、1回の実行につき1回）
    for week, names in groups.items() if run_birdnet else []:
        in_dir = os.path.join(work, f"in_w{week}")
        out_dir = os.path.join(work, f"out_w{week}")
        os.makedirs(out_dir, exist_ok=True)
        cmd = ["birdnet-analyze", in_dir, "-o", out_dir, "--min_conf", str(min_conf), "--rtype", "csv", "--locale", "ja", "-t", "2"]
        if location:
            cmd += ["--lat", str(location["lat"]), "--lon", str(location["lon"]), "--week", str(week), "--sf_thresh", str(sf_thresh)]
        proc = subprocess.run(cmd, capture_output=True, text=True)
        if proc.returncode != 0:
            for n in names:
                results[n] = {"error": "解析に失敗しました", "rows": [], "detail": (proc.stderr or proc.stdout)[-400:]}
            continue
        for n in names:
            stem = os.path.splitext(n)[0]
            info = channel_info.get(n, {"channels": 1, "derived": []})
            mix_rows = read_result_rows(os.path.join(out_dir, f"{stem}.BirdNET.results.csv"))
            entry = {"week": week if week != -1 else None, "channels": info["channels"]}
            if info["derived"]:
                by_channel = {"mix": mix_rows}
                for tag in info["derived"]:
                    by_channel[tag] = read_result_rows(os.path.join(out_dir, f"{stem}__ch{tag}.BirdNET.results.csv"))
                rows, gained = merge_best(by_channel)
                entry["stereo"] = {"counts": {k: len(v) for k, v in by_channel.items()}, "merged": len(rows), "gained_vs_mix": gained}
            else:
                rows = mix_rows
            entry["rows"] = rows
            results[n] = entry

    # BirdNET を動かさなかった（または、失敗しなかったが結果の入れ物が無い）ファイルにも、入れ物を作る
    for n in file_paths:
        results.setdefault(
            n,
            {"week": file_week[n] if file_week[n] != -1 else None, "channels": channel_info.get(n, {}).get("channels", 1), "rows": []},
        )

    # 別のモデル Perch（左右は混ぜた音・5秒ごと・上位5種）
    perch_meta = None
    if run_perch and file_paths:
        perch_meta = run_perch_analysis(file_paths, file_week, location, sf_thresh, results)

    return {
        "results": results,
        "warnings": warnings,
        "meta": {
            "model_name": MODEL_NAME,
            "model_version": MODEL_VERSION,
            "library": f"birdnet-analyzer {BIRDNET_VERSION}",
            "analyzed_at": datetime.now(timezone.utc).isoformat(),
            "params": {
                "min_conf": min_conf,
                "locale": "ja",
                "segment_sec": 3.0,
                "overlap": 0.0,
                "sensitivity": 1.0,
                "location_filter": bool(location),
                "lat": location["lat"] if location else None,
                "lon": location["lon"] if location else None,
                "use_week": bool(location and use_week),
                "sf_thresh": sf_thresh if location else None,
                "stereo": stereo,
            },
            "perch": perch_meta,
        },
        "elapsed_sec": round(time.time() - started, 1),
    }


# ---------- リアルタイム解析（BirdNET・Perch を読み込んだまま待機する） ----------
LIVE_MAX_BYTES = 512 * 1024  # リアルタイムで受け取る音（MP3）の大きさの上限（5秒・192kbps で約120KB）
MP3_DELAY_SAMPLES = 1105  # MP3 の符号化の遅れ（LAME：符号化 576＋読み込み 529）。捨てないと、BirdNET の3秒の区間がずれて、検出が4割ほど減る（下見の試験）
LIVE_SCALEDOWN_SEC = 300  # 最後に使ってから、この秒数は、モデルを読み込んだまま待機する（録音の休けいで、起こし直さないように）


@app.cls(image=analysis_image, cpu=2, memory=6144, timeout=120, scaledown_window=LIVE_SCALEDOWN_SEC, max_containers=3)
class LiveAnalyzer:
    """録音しながらの解析用。BirdNET と Perch を、最初に1回だけ読み込んで、そのあとは、短い音（約6秒）を、すぐに解析して返す。
    何も書き込まない（データベースの鍵も持たない）。呼び出しは、門番（web）経由だけ"""

    @modal.enter()
    def setup(self):
        import csv
        import os

        import birdnet_analyzer.config as cfg
        import numpy as np
        import tensorflow as tf
        from birdnet_analyzer import model as bn_model
        from birdnet_analyzer import utils as bn_utils

        # BirdNET（birdnet_analyzer.species.utils.run と同じ準備）
        cfg.MODEL_PATH = cfg.BIRDNET_MODEL_PATH
        cfg.LABELS_FILE = cfg.BIRDNET_LABELS_FILE
        cfg.SAMPLE_RATE = cfg.BIRDNET_SAMPLE_RATE
        cfg.SIG_LENGTH = cfg.BIRDNET_SIG_LENGTH
        cfg.LABELS = bn_utils.read_lines(cfg.LABELS_FILE)
        cfg.TFLITE_THREADS = 2
        bn_model.load_model()
        bn_model.predict(np.zeros((1, int(cfg.SAMPLE_RATE * cfg.SIG_LENGTH)), dtype="float32"))  # 初回の遅さを、ここで済ませる

        # Perch（CPU 版）
        self.perch_labels = [r[0] for r in csv.reader(open(os.path.join(PERCH_DIR, "assets", "labels.csv"), encoding="utf-8"))][1:]
        self.perch_index = {name: i for i, name in enumerate(self.perch_labels)}
        self.perch_infer = tf.saved_model.load(PERCH_DIR).signatures["serving_default"]
        self.perch_infer(inputs=tf.zeros((1, int(PERCH_SAMPLE_RATE * PERCH_WINDOW_SEC))))

        # 日本語名（BirdNET のラベル：学名_日本語名）
        self.ja = {}
        ja_file = os.path.join(cfg.TRANSLATED_LABELS_PATH, "BirdNET_GLOBAL_6K_V2.4_Labels_ja.txt")
        if os.path.exists(ja_file):
            for line in open(ja_file, encoding="utf-8"):
                sci, _, common = line.strip().partition("_")
                self.ja[sci] = common
        self.species_cache = {}

    def _decode(self, data: bytes, rate: int):
        """MP3 などの音（バイト列）を、モノラル・rate Hz の float32 にする"""
        import subprocess

        import numpy as np

        raw = subprocess.run(
            ["ffmpeg", "-v", "error", "-i", "pipe:0", "-ac", "1", "-ar", str(rate), "-f", "f32le", "-"],
            input=data,
            capture_output=True,
        ).stdout
        return np.frombuffer(raw, dtype=np.float32)

    def _allowed(self, location, week, sf_thresh):
        """場所＋時期の種の一覧（BirdNET の学名の集合, Perch のラベルの番号の並び）。場所が無ければ None"""
        import numpy as np
        from birdnet_analyzer.species.utils import get_species_list

        if not location:
            return None
        key = (round(location["lat"], 3), round(location["lon"], 3), week, sf_thresh)
        if key not in self.species_cache:
            sci_list = {x.split("_", 1)[0] for x in get_species_list(location["lat"], location["lon"], week, threshold=sf_thresh)}
            idx = set()
            for sci in sci_list:
                if sci in self.perch_index:
                    idx.add(self.perch_index[sci])
                for p in BIRDNET_TO_PERCH.get(sci, []):
                    if p in self.perch_index:
                        idx.add(self.perch_index[p])
            self.species_cache[key] = (sci_list, np.array(sorted(idx), dtype=np.int64))
        return self.species_cache[key]

    @modal.method()
    def warm(self) -> dict:
        """モデルを読み込んで待機させる（録音の画面を開いたときに、先に起こしておく）"""
        return {"ready": True}

    @modal.method()
    def analyze(self, req: dict) -> dict:
        """短い音（MP3・約5秒）を解析して、BirdNET（最後の3秒）と Perch（最後の5秒）の結果を返す。
        アプリは、録音の3秒ごとに、その時点までの最後の5秒を送る（3秒の区間の位置は、録音の始めから 3 秒の倍数にそろう）。
        req: audio（MP3 のバイト列）／codec_rate（MP3 の符号化のサンプルレート・標準 48000。遅れの補正に使う）／
             location {lat, lon} か None／week（1〜48。None なら時期の絞り込みなし）／
             samples（符号化した元の音のサンプル数〔codec_rate での数〕。あれば、長さをそろえる）／
             min_conf（BirdNET の下限・標準 0.25）／sf_thresh（絞り込みの基準・標準 0.03）／perch（False なら、Perch を動かさない）"""
        import time

        import birdnet_analyzer.config as cfg
        import numpy as np
        import tensorflow as tf
        from birdnet_analyzer import model as bn_model

        t_all = time.time()
        timings = {}
        location = req.get("location")
        week = req.get("week") or -1
        min_conf = float(req.get("min_conf", 0.25))
        sf_thresh = float(req.get("sf_thresh", 0.03))
        run_perch = bool(req.get("perch", True))
        codec_rate = int(req.get("codec_rate", 48000))

        t = time.time()
        a48 = self._decode(req["audio"], 48000)
        # MP3 の符号化の遅れを捨てる（符号化のサンプルレートでの 1105 サンプル → 48kHz でのサンプル数）
        trim = round(MP3_DELAY_SAMPLES * 48000 / codec_rate)
        if trim > 0:
            a48 = a48[trim:]
        if req.get("samples"):  # 符号化の終わりに付く余分な無音を捨てて、送られた音の長さにそろえる（3秒の区間の位置を、ずらさないため）
            a48 = a48[: round(int(req["samples"]) * 48000 / codec_rate)]
        a32 = None
        if run_perch and len(a48) > 0:
            from scipy.signal import resample_poly

            a32 = resample_poly(a48, 2, 3).astype(np.float32)  # 48kHz → 32kHz
        timings["decode"] = round(time.time() - t, 3)
        if len(a48) < 48000:  # 1秒未満は、解析できない
            return {"ok": False, "error": "音が短すぎます", "timings": timings}
        allowed = self._allowed(location, week, sf_thresh)
        allowed_sci = allowed[0] if allowed else None
        total_sec = len(a48) / 48000

        # BirdNET：最後の3秒（送られた音が3秒より短ければ、後ろに無音を足す）
        t = time.time()
        win = int(cfg.SAMPLE_RATE * cfg.SIG_LENGTH)
        seg48 = a48[-win:]
        if len(seg48) < win:
            seg48 = np.concatenate([seg48, np.zeros(win - len(seg48), dtype=np.float32)])
        p = bn_model.flat_sigmoid(
            np.array(bn_model.predict(seg48.reshape(1, win))), sensitivity=-1, bias=cfg.SIGMOID_SENSITIVITY
        )[0]
        found = np.where(p >= min_conf)[0]
        rows = []
        for i in found[np.argsort(-p[found])]:
            sci, _, eng = cfg.LABELS[i].partition("_")
            if allowed_sci is not None and sci not in allowed_sci:
                continue
            rows.append({"sci": sci, "common": self.ja.get(sci) or eng, "confidence": round(float(p[i]), 4)})
            if len(rows) >= 8:
                break
        b_end = round(total_sec, 2)
        birdnet = {"windows": [{"t0": round(max(0.0, b_end - cfg.SIG_LENGTH), 2), "t1": b_end, "species": rows}]}
        timings["birdnet"] = round(time.time() - t, 3)

        # Perch：最後の5秒（32kHz）
        perch = None
        pw = int(PERCH_SAMPLE_RATE * PERCH_WINDOW_SEC)
        if run_perch and a32 is not None and len(a32) >= pw - 160:  # 5秒に満たないとき（録音の始めの3秒）は、Perch は動かさない
            t = time.time()
            seg = a32[-pw:]
            if len(seg) < pw:
                seg = np.concatenate([seg, np.zeros(pw - len(seg), dtype=np.float32)])
            logits = self.perch_infer(inputs=tf.constant(seg.reshape(1, -1)))["label"].numpy()[0]
            idx = allowed[1] if allowed else np.arange(len(self.perch_labels))
            z = logits[idx]
            e = np.exp(z - z.max())
            prob = e / e.sum()
            merged = {}
            for j in np.argsort(-z)[:20]:
                label = self.perch_labels[idx[j]]
                sci = PERCH_TO_BIRDNET.get(label, label) if (allowed_sci is None or PERCH_TO_BIRDNET.get(label) in allowed_sci) else label
                m = merged.setdefault(sci, {"logit": float(z[j]), "prob": 0.0})
                m["logit"] = max(m["logit"], float(z[j]))
                m["prob"] += float(prob[j])
            top = sorted(merged.items(), key=lambda kv: -kv[1]["logit"])[:PERCH_TOP_K]
            t1 = round(len(a32) / PERCH_SAMPLE_RATE, 2)
            perch = {
                "windows": [
                    {
                        "t0": round(max(0.0, t1 - PERCH_WINDOW_SEC), 2),
                        "t1": t1,
                        "top": [{"sci": sci, "common": self.ja.get(sci), "logit": round(v["logit"], 2), "prob": round(v["prob"], 4)} for sci, v in top],
                    }
                ]
            }
            timings["perch"] = round(time.time() - t, 3)

        return {
            "ok": True,
            "birdnet": birdnet,
            "perch": perch,
            "location_filter": bool(location),
            "week": None if week == -1 else week,
            "elapsed_sec": round(time.time() - t_all, 3),
            "timings": timings,
        }


# ---------- 門番（ブラウザから呼ばれる入口） ----------
@app.function(image=gateway_image, timeout=600)
@modal.asgi_app()
def web():
    import re

    import requests
    import time

    from fastapi import FastAPI, Header, HTTPException, Request
    from fastapi.concurrency import run_in_threadpool
    from fastapi.middleware.cors import CORSMiddleware
    from typing import Literal

    from pydantic import BaseModel, Field

    api = FastAPI(title="Ambient Bird Log analyzer")
    api.add_middleware(
        CORSMiddleware,
        allow_origins=ALLOWED_ORIGINS,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["authorization", "apikey", "content-type"],
    )

    class Location(BaseModel):
        lat: float = Field(ge=-90, le=90)
        lon: float = Field(ge=-180, le=180)

    class AnalyzeRequest(BaseModel):
        files: list[str] = Field(min_length=1, max_length=MAX_FILES_PER_REQUEST)
        min_conf: float = Field(default=0.25, ge=0.01, le=0.99)
        location: Location | None = None
        use_week: bool = True
        stereo: Literal["best", "mix"] = "best"
        birdnet: bool = True
        perch: bool = False

    def require_admin(authorization: str | None, apikey: str | None):
        """ログイン中の管理者か、Supabase に確かめる（トークンが正しいか＋管理者名簿にいるか）"""
        if not authorization or not authorization.lower().startswith("bearer ") or not apikey:
            raise HTTPException(status_code=401, detail="ログインが必要です")
        headers = {"Authorization": authorization, "apikey": apikey}
        user = requests.get(f"{SUPABASE_URL}/auth/v1/user", headers=headers, timeout=10)
        if user.status_code != 200:
            raise HTTPException(status_code=401, detail="ログインの確認に失敗しました")
        admins = requests.get(f"{SUPABASE_URL}/rest/v1/app_admins?select=user_id&limit=1", headers=headers, timeout=10)
        if admins.status_code != 200 or not admins.json():
            raise HTTPException(status_code=403, detail="管理者だけが使えます")

    # ログインの確認は、Supabase に2回問い合わせる（約0.3秒）。リアルタイムは3秒おきに呼ぶので、確認済みのトークンは60秒、覚えておく
    verified = {}  # トークン → 有効な時刻（秒）

    def require_admin_cached(authorization: str | None, apikey: str | None):
        now = time.time()
        if authorization and verified.get(authorization, 0) > now:
            return
        require_admin(authorization, apikey)
        verified[authorization] = now + 60
        if len(verified) > 200:  # 溜まりすぎないように、古いものを捨てる
            for k in [k for k, v in verified.items() if v <= now]:
                verified.pop(k, None)

    @api.get("/health")
    def health():
        return {"ok": True, "model": f"{MODEL_NAME} {MODEL_VERSION}", "max_files": MAX_FILES_PER_REQUEST}

    @api.post("/analyze")
    def analyze(req: AnalyzeRequest, authorization: str | None = Header(default=None), apikey: str | None = Header(default=None)):
        require_admin(authorization, apikey)
        for name in req.files:
            if not re.fullmatch(r"[A-Za-z0-9._-]{1,100}\.(mp3|wav)", name):
                raise HTTPException(status_code=400, detail=f"ファイル名を使えません: {name}")
        return analyze_batch.remote(req.model_dump())

    @api.post("/live/warm")
    async def live_warm(authorization: str | None = Header(default=None), apikey: str | None = Header(default=None)):
        """録音の画面を開いたときに呼ぶ。モデルを読み込んだ待機の入れ物を、先に起こしておく（起きるまで待って返す＝返ったら、すぐ解析できる。約20秒）"""
        await run_in_threadpool(require_admin_cached, authorization, apikey)
        await LiveAnalyzer().warm.remote.aio()
        return {"ok": True}

    @api.post("/live")
    async def live(
        request: Request,
        lat: float | None = None,
        lon: float | None = None,
        week: int | None = None,
        min_conf: float = 0.25,
        perch: bool = True,
        codec_rate: int = 48000,
        samples: int | None = None,
        authorization: str | None = Header(default=None),
        apikey: str | None = Header(default=None),
    ):
        """録音しながらの解析。本文＝MP3（最後の約5秒）。返すのは、BirdNET（最後の3秒）と Perch（最後の5秒）の結果。何も保存しない"""
        await run_in_threadpool(require_admin_cached, authorization, apikey)
        data = await request.body()
        if not data or len(data) > LIVE_MAX_BYTES:
            raise HTTPException(status_code=400, detail="音の大きさが正しくありません")
        if (lat is None) != (lon is None) or (lat is not None and not (-90 <= lat <= 90 and -180 <= lon <= 180)):
            raise HTTPException(status_code=400, detail="場所が正しくありません")
        if week is not None and not (1 <= week <= 48):
            raise HTTPException(status_code=400, detail="週が正しくありません")
        if not (0.01 <= min_conf <= 0.99) or codec_rate not in (32000, 44100, 48000) or (samples is not None and not (0 < samples <= 10 * 48000)):
            raise HTTPException(status_code=400, detail="設定が正しくありません")
        req = {
            "audio": data,
            "location": {"lat": lat, "lon": lon} if lat is not None else None,
            "week": week,
            "min_conf": min_conf,
            "perch": perch,
            "codec_rate": codec_rate,
            "samples": samples,
        }
        return await LiveAnalyzer().analyze.remote.aio(req)

    return api


# ---------- 試験（何も書き込まない） ----------
@app.local_entrypoint()
def stereo_compare(out: str = "/tmp/stereo_compare.json"):
    """ステレオの録音を、「混ぜた音だけ」と「左右も別々に（標準）」で解析して、違いを比べる。結果をファイルに保存する"""
    import json

    cases = [
        (["260801_022_0613.mp3", "260905_011_1103.mp3"], {"lat": 35.280133, "lon": 139.6058746}),  # 森戸川源流
        (["260809_033_0737.mp3", "260809_036_0741.mp3"], {"lat": 35.4608547, "lon": 139.2095308}),  # 境沢林道
        (["260823_029_1152.mp3"], {"lat": 35.3894456, "lon": 139.4810827}),  # 境川遊水地公園
        (["260902_001_0522.mp3"], {"lat": 35.3454844, "lon": 139.5495189}),  # 今泉りす公園
    ]
    all_results = []
    for files, loc in cases:
        for mode in ("mix", "best"):
            res = analyze_batch.remote({"files": files, "location": loc, "min_conf": 0.25, "use_week": True, "stereo": mode})
            print(mode, files, "elapsed(s):", res["elapsed_sec"], {n: len(v["rows"]) for n, v in res["results"].items()})
            all_results.append({"mode": mode, "files": files, "location": loc, "response": res})
    with open(out, "w", encoding="utf-8") as f:
        json.dump(all_results, f, ensure_ascii=False)
    print("saved:", out)


@app.local_entrypoint()
def selftest(out: str = "/tmp/analyzer_selftest.json"):
    """既存の MP3 を、本番と同じ設定（場所＋時期・下限0.25）で解析して、結果をファイルに保存する"""
    import json

    hayato = {"lat": 35.5202047, "lon": 139.2054992}  # 早戸川林道 / 相模原市
    cases = [
        {"files": ["260712_012_Tr1.mp3", "260712_043_Tr1.mp3"], "location": hayato},
        {"files": ["260823_029_1152.mp3"], "location": {"lat": 35.3894456, "lon": 139.4810827}},
        {"files": ["260801_022_0613.mp3", "260905_011_1103.mp3"], "location": {"lat": 35.280133, "lon": 139.6058746}},
    ]
    all_results = []
    for c in cases:
        res = analyze_batch.remote({**c, "min_conf": 0.25, "use_week": True})
        print(c["files"], "elapsed(s):", res["elapsed_sec"], {n: len(v["rows"]) for n, v in res["results"].items()}, res["warnings"])
        all_results.append({"request": c, "response": res})
    with open(out, "w", encoding="utf-8") as f:
        json.dump(all_results, f, ensure_ascii=False)
    print("saved:", out)


@app.local_entrypoint()
def perch_selftest(out: str = "/tmp/perch_selftest.json"):
    """Perch を、既存の MP3 で試す（何も書き込まない）。①Perch だけ（BirdNET なし）②BirdNET と一緒に、を確かめて、結果をファイルに保存する"""
    import json

    cases = [
        {"files": ["260823_029_1152.mp3"], "location": {"lat": 35.3894456, "lon": 139.4810827}, "perch": True, "birdnet": False},
        {"files": ["260905_011_1103.mp3", "260905_014_1107.mp3"], "location": {"lat": 35.280133, "lon": 139.6058746}, "perch": True, "min_conf": 0.25},
        {"files": ["260905_011_1103.mp3"], "perch": True, "birdnet": False},  # 場所なし（絞り込みなし）
    ]
    all_results = []
    for c in cases:
        res = analyze_batch.remote(c)
        summary = {
            n: {"BirdNET": len(v["rows"]), "Perch の区間": len(v.get("perch", {}).get("windows", [])), "Perch の1位": [w["top"][0]["common"] or w["top"][0]["sci"] for w in v.get("perch", {}).get("windows", [])]}
            for n, v in res["results"].items()
        }
        print(c["files"], "elapsed(s):", res["elapsed_sec"], summary)
        all_results.append({"request": c, "response": res})
    with open(out, "w", encoding="utf-8") as f:
        json.dump(all_results, f, ensure_ascii=False)
    print("saved:", out)


@app.function(image=analysis_image, timeout=900, cpu=2, memory=4096)
def live_selftest_remote(name: str, lat: float, lon: float, week: int):
    """試験用：保管場所の MP3 を、3秒おきに「その時点までの最後の5秒」に切って、LiveAnalyzer に、
    アプリと同じ形（MP3・48kHz・モノラル・192kbps）で送り、かかった時間と、結果を返す。何も書き込まない"""
    import os
    import subprocess
    import tempfile
    import time

    import requests

    res = requests.get(f"{SUPABASE_URL}/storage/v1/object/public/{AUDIO_BUCKET}/{name}", timeout=60)
    res.raise_for_status()
    work = tempfile.mkdtemp()
    src = os.path.join(work, name)
    with open(src, "wb") as f:
        f.write(res.content)
    dur = float(
        subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", src], capture_output=True, text=True
        ).stdout.strip()
    )
    analyzer = LiveAnalyzer()
    calls = []
    t = 0.0
    while t + 3 <= dur + 0.01:
        start = max(0.0, t + 3 - 5)  # その時点までの、最後の5秒（最初の回は、3秒だけ）
        mp3 = subprocess.run(
            ["ffmpeg", "-v", "error", "-ss", str(start), "-t", str(t + 3 - start), "-i", src, "-ac", "1", "-ar", "48000", "-b:a", "192k", "-f", "mp3", "-"],
            capture_output=True,
        ).stdout
        t0 = time.time()
        r = analyzer.analyze.remote({"audio": mp3, "location": {"lat": lat, "lon": lon}, "week": week, "min_conf": 0.25, "samples": round((t + 3 - start) * 48000)})
        calls.append({"start": start, "bytes": len(mp3), "roundtrip_sec": round(time.time() - t0, 3), "result": r})
        t += 3.0
    return {"name": name, "duration": dur, "calls": calls}


@app.local_entrypoint()
def live_selftest(out: str = "/tmp/live_selftest.json"):
    """リアルタイム解析（LiveAnalyzer）の試験（何も書き込まない・公開もしない）。
    ①起こす時間（モデルの読み込み）②待機中の呼び出しの速さ ③既存の解析（BirdNET の CLI・Perch）との一致 を測る"""
    import json
    import time

    t0 = time.time()
    LiveAnalyzer().warm.remote()
    print(f"① 起動（モデルの読み込みを含む）: {time.time() - t0:.1f} 秒")
    t0 = time.time()
    LiveAnalyzer().warm.remote()
    print(f"② 待機中の呼び出し（何もしない）: {time.time() - t0:.2f} 秒")

    hayato = (35.5202047, 139.2054992)
    cases = [
        ("260905_011_1103.mp3", 35.280133, 139.6058746),
        ("260823_029_1152.mp3", 35.3894456, 139.4810827),
        ("260712_043_Tr1.mp3", *hayato),
    ]
    report = []
    for name, lat, lon in cases:
        week = week_from_filename(name)
        live = live_selftest_remote.remote(name, lat, lon, week)
        ref = analyze_batch.remote(
            {"files": [name], "location": {"lat": lat, "lon": lon}, "min_conf": 0.25, "use_week": True, "stereo": "mix", "perch": True}
        )
        ref_rows = ref["results"][name]["rows"]
        ref_perch = {w["t0"]: w for w in ref["results"][name].get("perch", {}).get("windows", [])}

        # BirdNET：本番（CLI）と、リアルタイムの、3秒ごとの種の一致（下限0.25）
        live_windows = {}  # 開始秒 → { 学名: 信頼度 }（同じ区間が2回出たときは、後の呼び出しの結果）
        for c in live["calls"]:
            for w in c["result"]["birdnet"]["windows"]:
                live_windows[round(c["start"] + w["t0"], 2)] = {r["sci"]: r["confidence"] for r in w["species"]}
        ref_windows = {}
        for r in ref_rows:
            ref_windows.setdefault(round(r["start_sec"], 2), {})[r["scientific_name"]] = r["confidence"]
        both = same = only_live = only_ref = 0
        diffs = []
        for start in sorted(set(live_windows) & set(ref_windows) | {s for s in ref_windows if s in live_windows}):
            L, R = live_windows.get(start, {}), ref_windows.get(start, {})
            for sci in set(L) | set(R):
                if sci in L and sci in R:
                    both += 1
                    diffs.append(abs(L[sci] - R[sci]))
                elif sci in L:
                    only_live += 1
                else:
                    only_ref += 1
        compared = sorted(set(live_windows) & set(ref_windows))
        times = [c["roundtrip_sec"] for c in live["calls"]]
        server = [c["result"].get("elapsed_sec") for c in live["calls"]]
        timing_detail = [c["result"].get("timings") for c in live["calls"]]
        print(
            f"\n{name}（{live['duration']:.1f}秒・{len(live['calls'])}回）\n"
            f"  往復の時間（秒）: 平均 {sum(times) / len(times):.2f}・最大 {max(times):.2f}／サーバー内 平均 {sum(server) / len(server):.2f}\n"
            f"  内訳の例: {timing_detail[len(timing_detail) // 2]}\n"
            f"  BirdNET（本番と同じ区間 {len(compared)}）: 両方が挙げた {both}・リアルタイムだけ {only_live}・本番だけ {only_ref}"
            f"・信頼度の差の平均 {(sum(diffs) / len(diffs)) if diffs else 0:.3f}"
        )
        # Perch：最後の5秒の1位が、本番（5秒ごと）と、同じ区間で一致するか（同じ区間＝時刻が5の倍数のとき）
        agree = total = 0
        for c in live["calls"]:
            pw = (c["result"].get("perch") or {}).get("windows", [])
            if not pw:
                continue
            start = round(c["start"] + pw[0]["t0"], 2)
            if start in ref_perch and pw[0]["top"] and ref_perch[start]["top"]:
                total += 1
                agree += int(pw[0]["top"][0]["sci"] == ref_perch[start]["top"][0]["sci"])
        print(f"  Perch: 本番と同じ5秒区間の1位が一致 {agree}/{total}")
        report.append({"name": name, "live": live, "ref_rows": ref_rows})
    with open(out, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False)
    print("\nsaved:", out)
