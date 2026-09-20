"""Ambient Bird Log の解析サーバー（Modal）。BirdNET で MP3 を解析して、結果（3秒ごとの記録）を返す。

・このサーバーは、記録を書き込まない（データベースの鍵も持たない）。解析して、結果を返すだけ。
  書き込みは、画面（ログイン中の管理者）が、自分の権限で行う（データベース側で「管理者名簿にいる人だけ」に制限済み）
・呼び出せるのは、ログイン中の管理者だけ。ログインのトークン（Supabase）と、管理者名簿で確認する。
  確認は、軽い「門番」の関数で行い、通ったときだけ、重い解析の関数を動かす（不正な呼び出しで、重い処理が動かないように）
・解析するファイルは、保管場所（bird-wav）の MP3。名前で指定する（ファイルそのものは受け取らない）

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
MAX_FILE_BYTES = 20 * 1024 * 1024  # 1ファイルの大きさの上限（MP3 は通常 0.3MB 前後）

# ---------- 実行環境（画像） ----------
# 解析用：BirdNET（TensorFlow）と、モデル本体（初回に約224MBをダウンロードするため、画像を作るときに1回動かして、中に入れておく）
analysis_image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg", "libsndfile1")
    .pip_install(f"birdnet-analyzer=={BIRDNET_VERSION}", "requests")
    .run_commands(
        "ffmpeg -loglevel error -f lavfi -i anullsrc=r=48000:cl=mono -t 3 /tmp/warm.wav",
        "birdnet-analyze /tmp/warm.wav -o /tmp/warm_out --min_conf 0.99 --rtype csv",
        "rm -rf /tmp/warm.wav /tmp/warm_out",
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


# ---------- 重い解析（BirdNET） ----------
@app.function(image=analysis_image, cpu=2, memory=4096, timeout=600)
def analyze_batch(request: dict) -> dict:
    """MP3（名前で指定）を、BirdNET で解析して、結果を返す。何も書き込まない。

    request:
      files:      MP3 の名前の一覧（保管場所 bird-wav にあるもの）
      min_conf:   信頼度の下限（標準 0.25）
      location:   {"lat": 緯度, "lon": 経度} … 場所の絞り込み。None なら絞り込みなし
      use_week:   True なら、録音の日付（ファイル名の YYMMDD）から週を求めて、時期でも絞り込む
      sf_thresh:  絞り込みの基準（標準 0.03）
      stereo:     "best"（標準）＝ステレオは、左右を別々にも解析して、（混ぜた音・左・右の）信頼度が一番高いものを採る
                  "mix"＝左右を混ぜた1つの音だけを解析する（BirdNET の標準の動き・Mac の BirdNET の画面と同じ）
                  ※左右のマイクが離れている録音は、左右がほぼ無関係な音になり、混ぜると、鳥の声が弱くなることがある
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

    work = tempfile.mkdtemp()
    results = {}
    warnings = []

    # ① 保管場所から MP3 を取ってくる
    groups = {}  # 週 → [ファイル名]（同じ週のものは、まとめて解析する）
    channel_info = {}  # ファイル名 → { channels：チャンネル数, derived：左右を分けて作ったチャンネルの印（"L"・"R"） }
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

        # ステレオ（"best"）：左右を別々の音（モノラルの WAV）にして、同じフォルダに置く＝同じ1回の実行で、一緒に解析される
        n_ch = count_channels(file_path)
        derived = []
        if stereo == "best" and n_ch == 2:
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
    for week, names in groups.items():
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
        },
        "elapsed_sec": round(time.time() - started, 1),
    }


# ---------- 門番（ブラウザから呼ばれる入口） ----------
@app.function(image=gateway_image, timeout=600)
@modal.asgi_app()
def web():
    import re

    import requests
    from fastapi import FastAPI, Header, HTTPException
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

    @api.get("/health")
    def health():
        return {"ok": True, "model": f"{MODEL_NAME} {MODEL_VERSION}", "max_files": MAX_FILES_PER_REQUEST}

    @api.post("/analyze")
    def analyze(req: AnalyzeRequest, authorization: str | None = Header(default=None), apikey: str | None = Header(default=None)):
        require_admin(authorization, apikey)
        for name in req.files:
            if not re.fullmatch(r"[A-Za-z0-9._-]{1,100}\.mp3", name):
                raise HTTPException(status_code=400, detail=f"ファイル名を使えません: {name}")
        return analyze_batch.remote(req.model_dump())

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
